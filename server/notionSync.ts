import { storage } from "./storage";
import {
  appendBlocksInChunks,
  buildBlocks,
  deleteNotionBlock,
  markdownToNotionBlocks,
  updatePageTitle,
} from "./notion";
import { ReplitConnectors } from "@replit/connectors-sdk";
import type {
  Image,
  Transcription,
  Checkpoint,
  TimelineItem,
} from "@shared/schema";

const connectors = new ReplitConnectors();

export type MappingKind =
  | "image"
  | "transcription"
  | "checkpoint"
  | "summary"
  | "ocr";

export type SyncItem =
  | { kind: "image"; content: Image; baseUrl: string }
  | { kind: "transcription"; content: Transcription }
  | { kind: "checkpoint"; content: Checkpoint }
  | { kind: "summary"; id: string; text: string; timestamp: Date }
  | { kind: "ocrText"; imageId: string; imageFileName: string; text: string }
  | { kind: "delete"; targetKind: MappingKind; localId: string }
  | { kind: "rename" };

type Job = { notebookId: string; item: SyncItem };

const queues = new Map<string, Job[]>();
const running = new Set<string>();
const backfilling = new Set<string>();

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

function mappingKeyForItem(item: SyncItem): { kind: MappingKind; localId: string } | null {
  switch (item.kind) {
    case "image":
      return { kind: "image", localId: item.content.id };
    case "transcription":
      return { kind: "transcription", localId: item.content.id };
    case "checkpoint":
      return { kind: "checkpoint", localId: item.content.id };
    case "summary":
      return { kind: "summary", localId: item.id };
    case "ocrText":
      return { kind: "ocr", localId: item.imageId };
    default:
      return null;
  }
}

async function processOne(notebookId: string, item: SyncItem): Promise<void> {
  // Handle rename: just update the Notion page title using current notebook state.
  if (item.kind === "rename") {
    const notebook = await storage.getNotebook(notebookId);
    if (!notebook || !notebook.notionPageId) return;
    const title = buildPageTitle(notebook.title, notebook.className, notebook.createdAt);
    await updatePageTitle(notebook.notionPageId, title);
    return;
  }

  // Handle delete: remove tracked blocks and the mapping.
  if (item.kind === "delete") {
    const blockIds = await storage.getNotionBlockIds(notebookId, item.localId, item.targetKind);
    if (blockIds.length === 0) return;
    for (const blockId of blockIds) {
      await deleteNotionBlock(blockId);
    }
    await storage.deleteNotionBlockMapping(notebookId, item.localId, item.targetKind);
    return;
  }

  // For OCR re-runs, drop any previously appended OCR blocks first so we
  // replace rather than duplicate them.
  if (item.kind === "ocrText") {
    const previous = await storage.getNotionBlockIds(notebookId, item.imageId, "ocr");
    for (const blockId of previous) {
      try {
        await deleteNotionBlock(blockId);
      } catch (e) {
        console.error(`Failed to delete previous OCR block ${blockId}:`, e);
      }
    }
    await storage.deleteNotionBlockMapping(notebookId, item.imageId, "ocr");
  }

  const pageId = await ensurePage(notebookId);
  const blocks = blocksForItem(item);
  if (blocks.length === 0) return;
  const createdIds = await appendBlocksInChunks(pageId, blocks);

  const mapping = mappingKeyForItem(item);
  if (mapping && createdIds.length > 0) {
    await storage.recordNotionBlocks(notebookId, mapping.localId, mapping.kind, createdIds);
  }
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

export function enqueueSync(
  notebookId: string,
  item: SyncItem,
  opts: { force?: boolean } = {}
): void {
  // Fire-and-forget; check the per-notebook toggle before queueing.
  (async () => {
    try {
      const notebook = await storage.getNotebook(notebookId);
      if (!notebook) return;
      // Manual operations (e.g. backfill) bypass the live-sync toggle so that
      // disabling auto-sync doesn't silently drop user-initiated work.
      if (!opts.force && notebook.notionSyncEnabled === false) return;
      // Skip rename/delete if there isn't a synced page yet — nothing to mirror.
      if ((item.kind === "rename" || item.kind === "delete") && !notebook.notionPageId) {
        return;
      }
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

export function getSyncQueueLength(notebookId: string): number {
  return queues.get(notebookId)?.length ?? 0;
}

export function isBackfilling(notebookId: string): boolean {
  return backfilling.has(notebookId);
}

function inflightKeys(notebookId: string): Set<string> {
  const keys = new Set<string>();
  const queue = queues.get(notebookId);
  if (!queue) return keys;
  for (const job of queue) {
    const k = mappingKeyForItem(job.item);
    if (k) keys.add(`${k.kind}:${k.localId}`);
  }
  return keys;
}

export type BackfillResult =
  | { ok: true; queued: number }
  | { ok: false; reason: "no-page" | "not-found" | "already-running" };

// Atomically compute and enqueue all unsynced historical items for a notebook
// in chronological order. Idempotent against both persisted mappings and
// items already sitting in the in-memory queue. Refuses to start if a
// backfill is already in progress for this notebook.
export async function backfillNotebook(
  notebookId: string,
  baseUrl: string
): Promise<BackfillResult> {
  if (backfilling.has(notebookId)) {
    return { ok: false, reason: "already-running" };
  }
  backfilling.add(notebookId);
  try {
    const notebook = await storage.getNotebook(notebookId);
    if (!notebook) return { ok: false, reason: "not-found" };
    if (!notebook.notionPageId) return { ok: false, reason: "no-page" };

    const [
      imagesList,
      transcriptionsList,
      checkpointsList,
      syncedImages,
      syncedTranscriptions,
      syncedCheckpoints,
      syncedOcr,
    ] = await Promise.all([
      storage.getImagesByNotebook(notebookId),
      storage.getTranscriptionsByNotebook(notebookId),
      storage.getCheckpointsByNotebook(notebookId),
      storage.getSyncedLocalIds(notebookId, "image"),
      storage.getSyncedLocalIds(notebookId, "transcription"),
      storage.getSyncedLocalIds(notebookId, "checkpoint"),
      storage.getSyncedLocalIds(notebookId, "ocr"),
    ]);

    const inflight = inflightKeys(notebookId);

    type Pending = { ts: number; order: number; item: SyncItem };
    const pending: Pending[] = [];
    let order = 0;

    for (const img of imagesList) {
      const ts = new Date(img.uploadedAt).getTime();
      if (!syncedImages.has(img.id) && !inflight.has(`image:${img.id}`)) {
        pending.push({
          ts,
          order: order++,
          item: { kind: "image", content: img, baseUrl },
        });
      }
      if (
        img.ocrText &&
        img.ocrText.trim().length > 0 &&
        !syncedOcr.has(img.id) &&
        !inflight.has(`ocr:${img.id}`)
      ) {
        pending.push({
          ts: ts + 1,
          order: order++,
          item: {
            kind: "ocrText",
            imageId: img.id,
            imageFileName: img.fileName,
            text: img.ocrText,
          },
        });
      }
    }
    for (const t of transcriptionsList) {
      if (syncedTranscriptions.has(t.id) || inflight.has(`transcription:${t.id}`)) continue;
      pending.push({
        ts: new Date(t.createdAt).getTime(),
        order: order++,
        item: { kind: "transcription", content: t },
      });
    }
    for (const c of checkpointsList) {
      if (syncedCheckpoints.has(c.id) || inflight.has(`checkpoint:${c.id}`)) continue;
      pending.push({
        ts: new Date(c.createdAt).getTime(),
        order: order++,
        item: { kind: "checkpoint", content: c },
      });
    }

    pending.sort((a, b) => (a.ts - b.ts) || (a.order - b.order));

    // Push synchronously to preserve sorted order — bypassing enqueueSync
    // (which is async and would race).
    let queue = queues.get(notebookId);
    if (!queue) {
      queue = [];
      queues.set(notebookId, queue);
    }
    for (const p of pending) {
      queue.push({ notebookId, item: p.item });
    }

    if (pending.length > 0) {
      runQueue(notebookId).catch((e) => {
        console.error(`Notion sync queue error for ${notebookId}:`, e);
      });
    }

    return { ok: true, queued: pending.length };
  } finally {
    backfilling.delete(notebookId);
  }
}
