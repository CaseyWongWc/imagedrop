import { storage } from "./storage";
import {
  appendBlocksInChunks,
  buildBlocks,
  markdownToNotionBlocks,
} from "./notion";
import { ReplitConnectors } from "@replit/connectors-sdk";
import type {
  Image,
  Transcription,
  Checkpoint,
  TimelineItem,
} from "@shared/schema";

const connectors = new ReplitConnectors();

export type SyncItem =
  | { kind: "image"; content: Image; baseUrl: string }
  | { kind: "transcription"; content: Transcription }
  | { kind: "checkpoint"; content: Checkpoint }
  | { kind: "summary"; id: string; text: string; timestamp: Date }
  | { kind: "ocrText"; imageFileName: string; text: string };

type Job = { notebookId: string; item: SyncItem };

const queues = new Map<string, Job[]>();
const running = new Set<string>();

function itemToTimelineItem(item: SyncItem): { timeline: TimelineItem; baseUrl: string } | null {
  if (item.kind === "image") {
    return {
      baseUrl: item.baseUrl,
      timeline: {
        id: item.content.id,
        type: "image",
        timestamp: item.content.uploadedAt,
        content: item.content,
      },
    };
  }
  if (item.kind === "transcription") {
    return {
      baseUrl: "",
      timeline: {
        id: item.content.id,
        type: "transcription",
        timestamp: item.content.createdAt,
        content: item.content,
      },
    };
  }
  if (item.kind === "checkpoint") {
    return {
      baseUrl: "",
      timeline: {
        id: item.content.id,
        type: "checkpoint",
        timestamp: item.content.createdAt,
        content: item.content,
      },
    };
  }
  return null;
}

function blocksForItem(item: SyncItem): Record<string, unknown>[] {
  if (item.kind === "ocrText") {
    return [
      {
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: [
            {
              type: "text",
              text: { content: `OCR — ${item.imageFileName}` },
              annotations: { italic: true, color: "gray" },
            },
          ],
        },
      },
      ...markdownToNotionBlocks(item.text),
    ];
  }
  if (item.kind === "summary") {
    const ts = new Date(item.timestamp).toLocaleString();
    return [
      {
        object: "block",
        type: "heading_3",
        heading_3: {
          rich_text: [
            { type: "text", text: { content: `AI Summary — ${ts}` } },
          ],
        },
      },
      ...markdownToNotionBlocks(item.text),
    ];
  }
  const tl = itemToTimelineItem(item);
  if (!tl) return [];
  return buildBlocks([tl.timeline], tl.baseUrl, true);
}

function buildPageTitle(notebookTitle: string, className: string | null | undefined, date: Date): string {
  const dateStr = new Date(date).toLocaleDateString();
  return [notebookTitle, className, dateStr].filter(Boolean).join(" — ");
}

async function ensurePage(notebookId: string): Promise<string> {
  const notebook = await storage.getNotebook(notebookId);
  if (!notebook) throw new Error("Notebook not found");
  if (notebook.notionPageId) return notebook.notionPageId;

  const title = buildPageTitle(notebook.title, notebook.className, notebook.createdAt);
  const body = {
    parent: { type: "workspace", workspace: true },
    properties: {
      title: [{ type: "text", text: { content: title } }],
    },
    children: [],
  };

  const res = await connectors.proxy("notion", "/v1/pages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(`Notion page create failed: ${JSON.stringify(err)}`);
  }
  const page = (await res.json()) as { id: string };
  await storage.setNotebookNotionPage(notebookId, page.id);
  return page.id;
}

async function processOne(notebookId: string, item: SyncItem): Promise<void> {
  const pageId = await ensurePage(notebookId);
  const blocks = blocksForItem(item);
  if (blocks.length === 0) return;
  await appendBlocksInChunks(pageId, blocks);
}

async function runQueue(notebookId: string): Promise<void> {
  if (running.has(notebookId)) return;
  running.add(notebookId);
  let exitedOnError = false;
  try {
    while (true) {
      const queue = queues.get(notebookId);
      if (!queue || queue.length === 0) break;
      const job = queue[0];

      let lastErr: unknown = null;
      let success = false;
      for (let attempt = 0; attempt < 4 && !success; attempt++) {
        try {
          if (attempt > 0) {
            const delay = Math.min(30000, 1000 * Math.pow(2, attempt));
            await new Promise((r) => setTimeout(r, delay));
          }
          await processOne(notebookId, job.item);
          success = true;
        } catch (e) {
          lastErr = e;
        }
      }

      if (!success) {
        const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
        const friendly = msg.includes("not configured") || msg.toLowerCase().includes("connector")
          ? "Notion connector is not configured"
          : msg.slice(0, 500);
        await storage.setNotebookSyncError(notebookId, friendly);
        exitedOnError = true;
        // Stop processing further items so order is preserved; will retry later.
        break;
      } else {
        queue.shift();
        await storage.setNotebookSyncError(notebookId, null);
      }
    }
  } finally {
    running.delete(notebookId);
    const queue = queues.get(notebookId);
    if (queue && queue.length > 0) {
      if (exitedOnError) {
        // Back off before retrying after a failure to avoid hammering Notion.
        setTimeout(() => {
          runQueue(notebookId).catch(() => {});
        }, 30000);
      } else {
        // New items arrived during a normal drain — kick immediately.
        setImmediate(() => {
          runQueue(notebookId).catch(() => {});
        });
      }
    }
  }
}

export function enqueueSync(notebookId: string, item: SyncItem): void {
  // Fire-and-forget; check the per-notebook toggle before queueing.
  (async () => {
    try {
      const notebook = await storage.getNotebook(notebookId);
      if (!notebook || notebook.notionSyncEnabled === false) return;
      let queue = queues.get(notebookId);
      if (!queue) {
        queue = [];
        queues.set(notebookId, queue);
      }
      queue.push({ notebookId, item });
      runQueue(notebookId).catch((e) => {
        console.error(`Notion sync queue error for ${notebookId}:`, e);
      });
    } catch (e) {
      console.error(`enqueueSync failed for ${notebookId}:`, e);
    }
  })();
}

export function getSyncStatus(notebookId: string): "idle" | "syncing" {
  const queue = queues.get(notebookId);
  const pending = (queue?.length ?? 0) > 0;
  return pending || running.has(notebookId) ? "syncing" : "idle";
}
