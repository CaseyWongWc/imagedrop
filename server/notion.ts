// Notion export service - uses Replit Connectors SDK (notion integration)
import { ReplitConnectors } from "@replit/connectors-sdk";
import type { TimelineItem, Image, Checkpoint } from "@shared/schema";

const connectors = new ReplitConnectors();

export class NotionNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotionNotFoundError";
  }
}

type NotionBlock = Record<string, unknown>;

type RichText = {
  type: "text";
  text: { content: string };
  annotations?: { bold?: boolean; italic?: boolean };
};

function splitText(text: string, maxLen: number): string[] {
  const chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    chunks.push(text.slice(i, i + maxLen));
    i += maxLen;
  }
  return chunks.length > 0 ? chunks : [""];
}

function parseInline(line: string): RichText[] {
  const parts = line.split(/(\*\*[^*]+\*\*)/g);
  const richTexts: RichText[] = [];
  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith("**") && part.endsWith("**")) {
      const content = part.slice(2, -2);
      for (const chunk of splitText(content, 2000)) {
        richTexts.push({ type: "text", text: { content: chunk }, annotations: { bold: true } });
      }
    } else {
      for (const chunk of splitText(part, 2000)) {
        richTexts.push({ type: "text", text: { content: chunk } });
      }
    }
  }
  return richTexts.length > 0 ? richTexts : [{ type: "text", text: { content: "" } }];
}

const NOTION_CODE_LANGUAGES = new Set(["abap","arduino","bash","basic","c","clojure","coffeescript","c++","c#","css","dart","diff","docker","elixir","elm","erlang","flow","fortran","f#","gherkin","glsl","go","graphql","groovy","haskell","html","java","javascript","json","julia","kotlin","latex","less","lisp","livescript","lua","makefile","markdown","markup","matlab","mermaid","nix","objective-c","ocaml","pascal","perl","php","plain text","powershell","prolog","protobuf","python","r","reason","ruby","rust","sass","scala","scheme","scss","shell","sql","swift","typescript","vb.net","verilog","vhdl","visual basic","webassembly","xml","yaml","java/c/c++/c#"]);

export function markdownToNotionBlocks(markdown: string): NotionBlock[] {
  const blocks: NotionBlock[] = [];
  const lines = markdown.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (line.startsWith("```")) {
      const rawLang = line.slice(3).trim().toLowerCase();
      const lang = NOTION_CODE_LANGUAGES.has(rawLang) ? rawLang : "plain text";
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      const code = codeLines.join("\n");
      for (const chunk of splitText(code, 2000)) {
        blocks.push({
          object: "block",
          type: "code",
          code: {
            language: lang,
            rich_text: [{ type: "text", text: { content: chunk } }],
          },
        });
      }
      continue;
    }

    // Bullet list (- or *)
    if (line.startsWith("- ") || line.startsWith("* ")) {
      blocks.push({
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: { rich_text: parseInline(line.slice(2)) },
      });
      i++;
      continue;
    }

    // Heading 3
    if (line.startsWith("### ")) {
      blocks.push({
        object: "block",
        type: "heading_3",
        heading_3: { rich_text: parseInline(line.slice(4)) },
      });
      i++;
      continue;
    }

    // Heading 2
    if (line.startsWith("## ")) {
      blocks.push({
        object: "block",
        type: "heading_2",
        heading_2: { rich_text: parseInline(line.slice(3)) },
      });
      i++;
      continue;
    }

    // Empty line → skip
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Regular paragraph (handles inline **bold**)
    blocks.push({
      object: "block",
      type: "paragraph",
      paragraph: { rich_text: parseInline(line) },
    });
    i++;
  }
  return blocks;
}

export function buildBlocks(
  timeline: TimelineItem[],
  baseUrl: string,
  includeDescriptions: boolean
): NotionBlock[] {
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

      if (includeDescriptions && img.ocrText) {
        blocks.push(...markdownToNotionBlocks(img.ocrText));
      }
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

export async function appendBlocksInChunks(
  pageId: string,
  blocks: NotionBlock[]
): Promise<string[]> {
  const CHUNK_SIZE = 100;
  const createdIds: string[] = [];
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
      if (res.status === 404) {
        throw new NotionNotFoundError(
          `Notion page or parent block not found: ${pageId}`
        );
      }
      const err = await res.json();
      throw new Error(`Failed to append blocks: ${JSON.stringify(err)}`);
    }
    const data = (await res.json()) as { results?: Array<{ id: string }> };
    if (data.results) {
      for (const block of data.results) createdIds.push(block.id);
    }
  }
  return createdIds;
}

export async function deleteNotionBlock(blockId: string): Promise<void> {
  const res = await connectors.proxy("notion", `/v1/blocks/${blockId}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    if (res.status === 404) {
      // The block (or its parent page) was deleted in Notion. Surface this
      // distinctly so the sync layer can clear its dead references and
      // recover, rather than silently ignoring it.
      throw new NotionNotFoundError(`Notion block not found: ${blockId}`);
    }
    const err = await res.json().catch(() => ({}));
    throw new Error(`Failed to delete block ${blockId}: ${JSON.stringify(err)}`);
  }
}

export async function updateHeading3Block(
  blockId: string,
  text: string
): Promise<void> {
  const res = await connectors.proxy("notion", `/v1/blocks/${blockId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      heading_3: {
        rich_text: [{ type: "text", text: { content: text } }],
      },
    }),
  });
  if (!res.ok) {
    if (res.status === 404) {
      throw new NotionNotFoundError(
        `Notion heading block not found: ${blockId}`
      );
    }
    const err = await res.json().catch(() => ({}));
    throw new Error(`Failed to update heading block ${blockId}: ${JSON.stringify(err)}`);
  }
}

export async function updatePageTitle(
  pageId: string,
  title: string
): Promise<void> {
  const res = await connectors.proxy("notion", `/v1/pages/${pageId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      properties: {
        title: { title: [{ type: "text", text: { content: title } }] },
      },
    }),
  });
  if (!res.ok) {
    if (res.status === 404) {
      throw new NotionNotFoundError(
        `Notion page not found: ${pageId}`
      );
    }
    const err = await res.json().catch(() => ({}));
    throw new Error(`Failed to update page title: ${JSON.stringify(err)}`);
  }
}

// =============================================================================
// PHASE 2: Subpage helpers
// -----------------------------------------------------------------------------
// Used by features like detailed summaries that create dedicated child pages
// under the synced notebook page. The live-sync engine MUST NOT call these
// helpers — these subpages are isolated from the live queue. See the guard
// in `server/notionSync.ts`.
// =============================================================================
export interface NotionSubpageResult {
  pageId: string;
  url: string;
}

export async function createNotionSubpage(
  parentPageId: string,
  title: string,
  blocks: NotionBlock[]
): Promise<NotionSubpageResult> {
  const firstBlocks = blocks.slice(0, 100);
  const remaining = blocks.slice(100);

  const body = {
    parent: { type: "page_id", page_id: parentPageId },
    properties: {
      title: [{ type: "text", text: { content: title } }],
    },
    children: firstBlocks,
  };

  const res = await connectors.proxy("notion", "/v1/pages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    if (res.status === 404) {
      throw new NotionNotFoundError(
        `Parent Notion page not found: ${parentPageId}`
      );
    }
    const err = await res.json().catch(() => ({}));
    throw new Error(`Failed to create Notion subpage: ${JSON.stringify(err)}`);
  }

  const page = (await res.json()) as { id: string; url: string };

  if (remaining.length > 0) {
    await appendBlocksInChunks(page.id, remaining);
  }

  return { pageId: page.id, url: page.url };
}

export interface NotionPage {
  id: string;
  title: string;
}

export async function listNotionPages(): Promise<NotionPage[]> {
  const res = await connectors.proxy("notion", "/v1/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filter: { property: "object", value: "page" }, page_size: 50 }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(`Notion search error: ${JSON.stringify(err)}`);
  }
  const data = await res.json() as { results: Array<Record<string, unknown>> };
  return data.results.map((page) => {
    const props = page.properties as Record<string, unknown> | undefined;
    let title = "Untitled";
    if (props) {
      const titleProp = (props.title ?? props.Name ?? props.name) as { title?: Array<{ plain_text?: string }> } | undefined;
      const firstText = titleProp?.title?.[0]?.plain_text;
      if (firstText) title = firstText;
    }
    return { id: page.id as string, title };
  });
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
  baseUrl: string,
  parentPageId?: string | null,
  includeDescriptions = true
): Promise<NotionExportResult> {
  const dateStr = new Date(notebookDate).toLocaleDateString();
  const pageTitle = [
    notebookTitle,
    notebookClass,
    dateStr,
  ]
    .filter(Boolean)
    .join(" — ");

  const allBlocks = buildBlocks(timeline, baseUrl, includeDescriptions);
  const firstBlocks = allBlocks.slice(0, 100);
  const remainingBlocks = allBlocks.slice(100);

  const parent = parentPageId
    ? { type: "page_id", page_id: parentPageId }
    : { type: "workspace", workspace: true };

  const body = {
    parent,
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
