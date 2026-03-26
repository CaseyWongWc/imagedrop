// Notion export service - uses Replit Connectors SDK (notion integration)
import { ReplitConnectors } from "@replit/connectors-sdk";
import type { TimelineItem, Image, Checkpoint } from "@shared/schema";

const connectors = new ReplitConnectors();

type NotionBlock = Record<string, unknown>;

function buildBlocks(timeline: TimelineItem[], baseUrl: string): NotionBlock[] {
  const blocks: NotionBlock[] = [];

  for (const item of timeline) {
    const timestamp = new Date(item.timestamp).toLocaleString();

    if (item.type === "image") {
      const img = item.content as Image;
      const imageUrl = `${baseUrl}${img.objectPath}`;

      blocks.push({
        object: "block",
        type: "image",
        image: {
          type: "external",
          external: { url: imageUrl },
          caption: [
            {
              type: "text",
              text: { content: `${img.fileName} — ${timestamp}` },
            },
          ],
        },
      });
    } else if (item.type === "transcription") {
      const trans = item.content as { text: string };
      const chunks = splitText(trans.text, 2000);
      for (const chunk of chunks) {
        blocks.push({
          object: "block",
          type: "paragraph",
          paragraph: {
            rich_text: [{ type: "text", text: { content: chunk } }],
          },
        });
      }
      blocks.push({
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: [
            {
              type: "text",
              text: { content: `— Transcription at ${timestamp}` },
              annotations: { italic: true, color: "gray" },
            },
          ],
        },
      });
    } else if (item.type === "checkpoint") {
      const cp = item.content as Checkpoint;
      blocks.push({
        object: "block",
        type: "divider",
        divider: {},
      });
      blocks.push({
        object: "block",
        type: "heading_3",
        heading_3: {
          rich_text: [
            {
              type: "text",
              text: {
                content: `Checkpoint: ${cp.label || "Checkpoint"} — ${timestamp}`,
              },
            },
          ],
        },
      });
    }
  }

  return blocks;
}

function splitText(text: string, maxLen: number): string[] {
  const chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    chunks.push(text.slice(i, i + maxLen));
    i += maxLen;
  }
  return chunks.length > 0 ? chunks : [""];
}

async function appendBlocksInChunks(
  pageId: string,
  blocks: NotionBlock[]
): Promise<void> {
  const CHUNK_SIZE = 100;
  for (let i = 0; i < blocks.length; i += CHUNK_SIZE) {
    const chunk = blocks.slice(i, i + CHUNK_SIZE);
    const res = await connectors.proxy(
      "notion",
      `/v1/blocks/${pageId}/children`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ children: chunk }),
      }
    );
    if (!res.ok) {
      const err = await res.json();
      throw new Error(`Failed to append blocks: ${JSON.stringify(err)}`);
    }
  }
}

export interface NotionExportResult {
  url: string;
  pageId: string;
}

export async function exportNotebookToNotion(
  notebookTitle: string,
  notebookClass: string | null | undefined,
  notebookDate: Date,
  timeline: TimelineItem[],
  baseUrl: string
): Promise<NotionExportResult> {
  const dateStr = new Date(notebookDate).toLocaleDateString();
  const pageTitle = [
    notebookTitle,
    notebookClass,
    dateStr,
  ]
    .filter(Boolean)
    .join(" — ");

  const firstBlocks = buildBlocks(timeline, baseUrl).slice(0, 100);
  const remainingBlocks = buildBlocks(timeline, baseUrl).slice(100);

  const body = {
    parent: { type: "workspace", workspace: true },
    properties: {
      title: [{ type: "text", text: { content: pageTitle } }],
    },
    children: firstBlocks,
  };

  const res = await connectors.proxy("notion", "/v1/pages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(`Notion API error: ${JSON.stringify(err)}`);
  }

  const page = await res.json() as { id: string; url: string };

  if (remainingBlocks.length > 0) {
    await appendBlocksInChunks(page.id, remainingBlocks);
  }

  return {
    pageId: page.id,
    url: page.url,
  };
}
