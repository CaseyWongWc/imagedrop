// ============================================================================
// PHASE-2: Attachments Notion sync queue
// ----------------------------------------------------------------------------
// STRICT PHASE-2 ISOLATION:
// - This file MUST NOT import from notionSync.ts or touch notion_block_mappings.
// - The live-sync engine in notionSync.ts MUST NOT call anything here.
// - A failed attachment sync NEVER rolls back live-sync state.
// - Files always upload to object storage first; Notion mirroring is best-effort.
// ============================================================================

import { storage } from "./storage";
import {
  appendBlocksInChunks,
  createNotionSubpage,
  deleteNotionBlock,
  markdownToNotionBlocks,
  NotionNotFoundError,
} from "./notion";
import type { Attachment, Notebook } from "@shared/schema";

type AttachSyncJob =
  | { kind: "upsert"; attachmentId: string }
  | { kind: "delete"; attachmentId: string; notionBlockId: string }
  | { kind: "remirror" };

type Job = { notebookId: string; item: AttachSyncJob };

const queues = new Map<string, Job[]>();
const running = new Set<string>();

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const SG_SECTION_LABELS: Record<string, string> = {
  topics: "Topics",
  keyConcepts: "Key Concepts",
  definitions: "Definitions",
  workedExamples: "Worked Examples",
  practiceQuestions: "Practice Questions",
  flaggedGaps: "Flagged Gaps",
};

function linkLabel(a: Attachment): string {
  if (!a.linkedToType || !a.linkedToId) return "";
  if (a.linkedToType === "study_guide_section") {
    // linkedToId format: "{guideId}:{sectionName}"
    const colonIdx = a.linkedToId.indexOf(":");
    const sectionName = colonIdx >= 0 ? a.linkedToId.slice(colonIdx + 1) : a.linkedToId;
    const label = SG_SECTION_LABELS[sectionName] ?? sectionName;
    return `Linked to study guide section: ${label}`;
  }
  const map: Record<string, string> = {
    image: "photo",
    transcription: "transcript",
    checkpoint: "checkpoint",
    detailed_summary: "detailed summary",
  };
  return `Linked to ${map[a.linkedToType] ?? a.linkedToType} (${a.linkedToId.slice(0, 8)}…)`;
}

// Build the Notion blocks for a single attachment row on the subpage.
function attachmentBlocks(a: Attachment, baseUrl: string): Record<string, unknown>[] {
  const link = linkLabel(a);
  const meta = [
    `**${a.fileName}**`,
    humanSize(a.fileSize),
    new Date(a.uploadedAt).toLocaleString(),
    link,
  ]
    .filter(Boolean)
    .join(" · ");

  const fileUrl = `${baseUrl}${a.objectPath}`;
  const isImage = a.mimeType.startsWith("image/");

  const blocks: Record<string, unknown>[] = [];

  if (isImage) {
    blocks.push({
      object: "block",
      type: "image",
      image: {
        type: "external",
        external: { url: fileUrl },
        caption: [{ type: "text", text: { content: meta } }],
      },
    });
  } else {
    blocks.push({
      object: "block",
      type: "bookmark",
      bookmark: {
        url: fileUrl,
        caption: [{ type: "text", text: { content: meta } }],
      },
    });
  }
  return blocks;
}

// -----------------------------------------------------------------------
// Per-notebook subpage management
// -----------------------------------------------------------------------

async function ensureAttachmentsSubpage(
  notebook: Notebook,
  baseUrl: string
): Promise<string> {
  // Always re-read from storage to avoid stale in-memory subpage ID.
  const fresh = await storage.getNotebook(notebook.id);
  if (!fresh) throw new Error(`Notebook ${notebook.id} not found`);

  if (fresh.attachmentsSubpageId) return fresh.attachmentsSubpageId;

  if (!fresh.notionPageId) {
    throw new Error("Notebook has no synced Notion page yet");
  }

  const sub = await createNotionSubpage(
    fresh.notionPageId,
    "Attachments",
    markdownToNotionBlocks("_Attached files for this notebook._")
  );
  await storage.setNotebookAttachmentsSubpage(fresh.id, sub.pageId);
  return sub.pageId;
}

// Append a new block for `attachment` to the subpage and persist the block ID.
async function mirrorAttachment(
  attachment: Attachment,
  subpageId: string,
  baseUrl: string
): Promise<void> {
  const blocks = attachmentBlocks(attachment, baseUrl);
  const ids = await appendBlocksInChunks(subpageId, blocks);
  const blockId = ids[0] ?? null;
  await storage.setAttachmentNotionBlockId(attachment.id, blockId);
}

// -----------------------------------------------------------------------
// Queue processor
// -----------------------------------------------------------------------

async function processOne(notebookId: string, item: AttachSyncJob, baseUrl: string): Promise<void> {
  const notebook = await storage.getNotebook(notebookId);
  if (!notebook || !notebook.notionPageId) return;

  if (item.kind === "delete") {
    // Delete the block from Notion, silently ignore if already gone.
    try {
      await deleteNotionBlock(item.notionBlockId);
    } catch (e) {
      if (!(e instanceof NotionNotFoundError)) throw e;
    }
    return;
  }

  if (item.kind === "upsert") {
    const attachment = await storage.getAttachment(item.attachmentId);
    if (!attachment) return;

    // If there's an existing Notion block for this attachment, delete it first
    // (update = delete old + append new, so ordering is preserved at end of page).
    const existingBlockId = await storage.getAttachmentNotionBlockId(attachment.id);
    if (existingBlockId) {
      try {
        await deleteNotionBlock(existingBlockId);
      } catch (e) {
        if (!(e instanceof NotionNotFoundError)) {
          console.warn(`Could not delete old attachment block ${existingBlockId}:`, e);
        }
      }
      await storage.setAttachmentNotionBlockId(attachment.id, null);
    }

    let subpageId: string;
    try {
      subpageId = await ensureAttachmentsSubpage(notebook, baseUrl);
    } catch (e) {
      if (e instanceof NotionNotFoundError) {
        // Parent page deleted — recover by clearing subpage ref; live-sync
        // will recreate the parent page on its own path.
        await storage.setNotebookAttachmentsSubpage(notebookId, null);
        return;
      }
      throw e;
    }

    await mirrorAttachment(attachment, subpageId, baseUrl);
    return;
  }

  if (item.kind === "remirror") {
    // Recreate the attachments subpage from scratch (recovery after 404).
    // Drop existing subpage ref and all per-attachment block mappings first.
    await storage.setNotebookAttachmentsSubpage(notebookId, null);
    await storage.clearAttachmentBlockMappingsByNotebook(notebookId);

    const allAttachments = await storage.getAttachmentsByNotebook(notebookId);
    if (allAttachments.length === 0) return;

    // ensureAttachmentsSubpage re-fetches the notebook, so it will see the
    // cleared subpageId and create a fresh subpage.
    let subpageId: string;
    try {
      subpageId = await ensureAttachmentsSubpage(notebook, baseUrl);
    } catch (e) {
      if (e instanceof NotionNotFoundError) {
        await storage.setNotebookAttachmentsSubpage(notebookId, null);
        return;
      }
      throw e;
    }

    for (const a of allAttachments) {
      await mirrorAttachment(a, subpageId, baseUrl);
    }
  }
}

async function runQueue(notebookId: string, baseUrl: string): Promise<void> {
  if (running.has(notebookId)) return;
  running.add(notebookId);
  try {
    while (true) {
      const queue = queues.get(notebookId);
      if (!queue || queue.length === 0) break;
      const job = queue[0];

      let success = false;
      let lastErr: unknown = null;
      for (let attempt = 0; attempt < 3 && !success; attempt++) {
        try {
          if (attempt > 0) {
            await new Promise((r) => setTimeout(r, Math.min(10000, 1000 * Math.pow(2, attempt))));
          }
          await processOne(notebookId, job.item, baseUrl);
          success = true;
        } catch (e) {
          if (!success && e instanceof NotionNotFoundError) {
            // Attachments subpage was deleted. Drop our reference and
            // re-mirror everything — do NOT touch live-sync state.
            console.warn(`Attachment sync 404 for notebook ${notebookId}: ${(e as Error).message}`);
            await storage.setNotebookAttachmentsSubpage(notebookId, null);
            // Replace current job with a remirror so remaining items aren't lost.
            queue[0] = { notebookId, item: { kind: "remirror" } };
            try {
              await processOne(notebookId, { kind: "remirror" }, baseUrl);
              success = true;
            } catch {
              // Give up this cycle; retry next drain.
              break;
            }
          } else {
            lastErr = e;
          }
        }
      }

      if (!success) {
        console.error(`Attachment sync failed for ${notebookId} after retries:`, lastErr);
        break;
      }
      queue.shift();
    }
  } finally {
    running.delete(notebookId);
    const queue = queues.get(notebookId);
    if (queue && queue.length > 0) {
      setImmediate(() => runQueue(notebookId, baseUrl).catch(() => {}));
    }
  }
}

// -----------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------

export function enqueueAttachmentSync(
  notebookId: string,
  item: AttachSyncJob,
  baseUrl: string
): void {
  (async () => {
    try {
      const notebook = await storage.getNotebook(notebookId);
      if (!notebook) return;
      if (!notebook.mirrorAttachmentsToNotion) return;
      if (!notebook.notionPageId) return;

      let queue = queues.get(notebookId);
      if (!queue) {
        queue = [];
        queues.set(notebookId, queue);
      }
      queue.push({ notebookId, item });
      runQueue(notebookId, baseUrl).catch((e) => {
        console.error(`Attachment sync queue error for ${notebookId}:`, e);
      });
    } catch (e) {
      console.error(`enqueueAttachmentSync failed for ${notebookId}:`, e);
    }
  })();
}
