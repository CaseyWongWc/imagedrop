// Reference: javascript_object_storage blueprint - Routes for public file uploading
import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import {
  ObjectStorageService,
  ObjectNotFoundError,
} from "./replit_integrations/object_storage";
import { 
  insertImageSchema, 
  insertTranscriptionSchema, 
  insertNotebookSchema,
  insertCheckpointSchema,
  insertAttachmentSchema,
  ATTACHMENT_LINK_TYPES,
  type Image,
  type Transcription,
  type Checkpoint,
  type TimelineItem,
  type DetailedSummary,
  type Attachment,
} from "@shared/schema";
import { TranscriptionService } from "./transcription";
import { VisionService } from "./vision";
import {
  exportNotebookToNotion,
  listNotionPages,
  createNotionSubpage,
  markdownToNotionBlocks,
  appendBlocksAfter,
  deleteNotionBlock,
  NotionNotFoundError,
} from "./notion";
import {
  STUDY_GUIDE_SECTION_NAMES,
  type StudyGuideSectionName,
  type StudyGuideSections,
  type StudyGuide,
} from "@shared/schema";
import { enqueueSync, getSyncStatus, getSyncQueueLength, backfillNotebook, isBackfilling } from "./notionSync";
import { enqueueAttachmentSync } from "./attachmentSync";
import { randomUUID } from "crypto";

// In-memory tracker for in-flight detailed-summary generations per notebook.
// Used by the UI to show a "generating" indicator and to prevent runaway
// concurrent runs.
const generatingDetailedSummary = new Set<string>();

// Same idea, but for study-guide generation. Per-notebook (not per-section).
const generatingStudyGuide = new Set<string>();

const DETAILED_SUMMARY_MODEL = "gpt-4o";
const STUDY_GUIDE_MODEL = "gpt-4o";

// ── Token-budget constants ────────────────────────────────────────────────────
// GPT-4o starter tier: 30 000 TPM.  We reserve 4 096 for the output and ~1 000
// for the static prompt preamble, leaving ~24 900 tokens for all dynamic input.
// At ~4 chars/token that is ~99 600 chars — we target 60 000 chars for the main
// corpus (generous but well under the limit) and 5 000 for prior-context blurbs.
const MAX_CORPUS_CHARS = 60_000;
const MAX_PRIOR_CONTEXT_CHARS = 5_000;

/**
 * Trim a pre-sorted (chronological) array of {ts, text} entries so the joined
 * result stays within maxChars.  Drops the OLDEST entries first so the most
 * recent lecture material is always preserved.  Returns the joined string and a
 * flag indicating whether any trimming occurred.
 */
function trimEntriesToBudget(
  entries: { ts: number; text: string }[],
  separator: string,
  maxChars: number
): { text: string; wasTrimmed: boolean } {
  const sepLen = separator.length;
  let totalLen = 0;
  const kept: string[] = [];
  // Walk from newest → oldest so we always keep the most recent content.
  for (let i = entries.length - 1; i >= 0; i--) {
    const entryLen = entries[i].text.length + (kept.length > 0 ? sepLen : 0);
    if (totalLen + entryLen > maxChars) continue; // skip — too large
    kept.unshift(entries[i].text);
    totalLen += entryLen;
  }
  const wasTrimmed = kept.length < entries.length;
  const body = kept.join(separator);
  return { text: body, wasTrimmed };
}

function formatSubpageTitle(d: Date): string {
  // e.g. "Detailed Summary — Apr 21 11:47 AM"
  const month = d.toLocaleString("en-US", { month: "short" });
  const day = d.getDate();
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `Detailed Summary — ${month} ${day} ${time}`;
}

interface InSessionSummaryInput {
  text: string;
  timestamp: string | Date;
}

type GenerateDetailedSummaryResult =
  | { ok: true; summary: DetailedSummary }
  | { ok: false; reason: string; status: number };

async function buildDetailedSummaryCorpus(
  notebookId: string,
  inSessionSummaries: InSessionSummaryInput[] = []
): Promise<string> {
  const [imagesList, transcriptionsList, checkpointsList] = await Promise.all([
    storage.getImagesByNotebook(notebookId),
    storage.getTranscriptionsByNotebook(notebookId),
    storage.getCheckpointsByNotebook(notebookId),
  ]);
  type Entry = { ts: number; text: string };
  const entries: Entry[] = [];
  for (const img of imagesList) {
    if (img.ocrText && img.ocrText.trim().length > 0) {
      entries.push({
        ts: new Date(img.uploadedAt).getTime(),
        text: `[Photo OCR — ${img.fileName} @ ${new Date(img.uploadedAt).toLocaleString()}]\n${img.ocrText}`,
      });
    }
  }
  for (const t of transcriptionsList) {
    entries.push({
      ts: new Date(t.createdAt).getTime(),
      text: `[Transcript @ ${new Date(t.createdAt).toLocaleString()}]\n${t.text}`,
    });
  }
  for (const cp of checkpointsList) {
    entries.push({
      ts: new Date(cp.createdAt).getTime(),
      text: `[Checkpoint @ ${new Date(cp.createdAt).toLocaleString()}] ${cp.label || "Checkpoint"}`,
    });
  }
  for (const s of inSessionSummaries) {
    const tsDate = new Date(s.timestamp);
    entries.push({
      ts: tsDate.getTime(),
      text: `[In-session AI summary @ ${tsDate.toLocaleString()}]\n${s.text}`,
    });
  }
  entries.sort((a, b) => a.ts - b.ts);
  const SEP = "\n\n---\n\n";
  const { text, wasTrimmed } = trimEntriesToBudget(entries, SEP, MAX_CORPUS_CHARS);
  if (wasTrimmed) {
    return (
      `> **Note:** Some earlier session content was omitted to stay within model input limits. The most recent captures are preserved.\n\n` +
      text
    );
  }
  return text;
}

// Core generation routine. Public via the explicit POST endpoint and via the
// auto-trigger that fires when a session is flipped to ended.
//
// Phase-2 isolation: failures here NEVER touch live-sync state, the live
// queue, or `notion_block_mappings`. Only the detailed_summaries row and
// its dedicated subpage block mapping are affected.
async function generateDetailedSummary(
  notebookId: string,
  inSessionSummaries: InSessionSummaryInput[] = []
): Promise<GenerateDetailedSummaryResult> {
  if (generatingDetailedSummary.has(notebookId)) {
    return { ok: false, reason: "A detailed summary is already being generated for this notebook.", status: 409 };
  }
  generatingDetailedSummary.add(notebookId);
  try {
    const notebook = await storage.getNotebook(notebookId);
    if (!notebook) return { ok: false, reason: "Notebook not found", status: 404 };
    if (!notebook.notionPageId) {
      return {
        ok: false,
        reason: "Notebook has no synced Notion page yet. Use Send to Notion first.",
        status: 400,
      };
    }

    const corpus = await buildDetailedSummaryCorpus(notebookId, inSessionSummaries);
    const priorSummaries = await storage.getDetailedSummariesByNotebook(notebookId);
    const rawPriorContext = priorSummaries
      .slice(0, 3)
      .map(
        (s) =>
          `[Prior detailed summary from ${new Date(s.createdAt).toLocaleString()}]\n${s.content}`
      )
      .join("\n\n---\n\n");
    const priorContext = rawPriorContext.slice(0, MAX_PRIOR_CONTEXT_CHARS);

    if (corpus.trim().length === 0) {
      return {
        ok: false,
        reason: "Notebook has no captured content yet — nothing to summarize.",
        status: 400,
      };
    }

    const OpenAI = (await import("openai")).default;
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const prompt = `You are producing a thorough post-class detailed summary of an entire lecture/study session. Quality and completeness matter more than brevity.

Produce well-structured markdown with the following sections (use ## headings):

## Overview
A 2-4 sentence high-level summary of what the session covered.

## Detailed Notes by Topic
Organized notes grouped by topic/subtopic. Use ### subheadings for distinct topics. Preserve formulas with $...$ / $$...$$, code with fenced blocks, and definitions in **bold**.

## Key Concepts
A bulleted list of the most important terms, definitions, and ideas to remember.

## Open Questions
Anything that seemed unresolved, ambiguous, or worth following up on.

## Connections
Brief notes on how the topics relate to each other or to prior material.

${
  priorContext
    ? `Prior detailed summaries from earlier generations of this same notebook (use only for continuity, do not just repeat them):\n\n${priorContext}\n\n---\n\n`
    : ""
}Captured session material (chronological):\n\n${corpus}`;

    const response = await openai.chat.completions.create({
      model: DETAILED_SUMMARY_MODEL,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 4096,
    });
    const content = response.choices[0]?.message?.content?.trim() ?? "";
    const tokenCount = response.usage?.total_tokens ?? 0;

    if (!content) {
      return { ok: false, reason: "Model returned an empty summary", status: 502 };
    }

    // Persist the row first so the result is durable even if Notion push
    // fails. notionSubpageId stays null until the subpage is created.
    const row = await storage.createDetailedSummary({
      id: randomUUID(),
      notebookId,
      content,
      model: DETAILED_SUMMARY_MODEL,
      tokenCount,
    });

    // Push to a dedicated Notion subpage. On 404 (parent page deleted in
    // Notion), drop our reference so the next generation creates a fresh
    // subpage. We do NOT touch live-sync state from here.
    const subpageTitle = formatSubpageTitle(new Date(row.createdAt));
    const blocks = markdownToNotionBlocks(content);
    try {
      const sub = await createNotionSubpage(notebook.notionPageId, subpageTitle, blocks);
      const updated = (await storage.setDetailedSummarySubpage(row.id, sub.pageId, sub.url)) ?? row;
      // Track the appended blocks in the Phase-2 mapping table — explicitly
      // separate from notion_block_mappings to satisfy the isolation guard.
      // (Currently informational; reserved for future Phase-2 features.)
      // We don't have createdIds for the page itself; appendBlocksInChunks
      // returns ids only when chunks > 100 — so we record an empty list when
      // unknown rather than fabricating.
      await storage.recordDetailedSummaryBlocks(row.id, []);
      return { ok: true, summary: updated };
    } catch (e) {
      if (e instanceof NotionNotFoundError) {
        // The synced parent page was deleted in Notion. Phase-2 isolation
        // forbids us from mutating live-sync state from this failure path,
        // so we ONLY clear the detailed-summary row's own subpage state.
        // Live-sync will detect and recover the parent page on its next
        // operation through its own 404 handling path.
        console.warn(
          `Detailed-summary subpage push hit 404 for notebook ${notebookId}; leaving live-sync state untouched. Next generation will create a fresh subpage once live-sync recreates the parent.`
        );
        const cleared = await storage.setDetailedSummarySubpage(row.id, null, null);
        await storage.clearDetailedSummaryBlocks(row.id);
        return { ok: true, summary: cleared ?? row };
      }
      console.error("Detailed-summary Notion push failed:", e);
      // Row still saved without subpage — UI surfaces this as "no Notion link yet".
      return { ok: true, summary: row };
    }
  } finally {
    generatingDetailedSummary.delete(notebookId);
  }
}

// ============================================================================
// PHASE 2: Study Guide generation
// ----------------------------------------------------------------------------
// Mirrors the Detailed Summary pipeline:
// - Versioned (rows are never overwritten on full regenerate; new row created)
// - Pushed to a dedicated subpage under the notebook's Notion page
// - Block IDs are tracked in `study_guide_block_mappings` (NOT in
//   `notion_block_mappings`) so per-section regenerate can locate exactly
//   the blocks it needs to delete and re-append.
// - Uses [needs review] placeholders rather than hallucinating; this is a
//   prompt requirement, enforced by the model.
// - Failures NEVER touch live-sync state (no enqueueSync, no backfill).
// ============================================================================

const SECTION_HEADINGS: Record<StudyGuideSectionName, string> = {
  topics: "Topics",
  keyConcepts: "Key Concepts",
  definitions: "Definitions",
  workedExamples: "Worked Examples",
  practiceQuestions: "Practice Questions",
  flaggedGaps: "Flagged Gaps",
};

function emptySections(): StudyGuideSections {
  return {
    topics: "",
    keyConcepts: "",
    definitions: "",
    workedExamples: "",
    practiceQuestions: "",
    flaggedGaps: "",
  };
}

function parseSections(json: string): StudyGuideSections {
  try {
    const parsed = JSON.parse(json) as Partial<StudyGuideSections>;
    const out = emptySections();
    for (const name of STUDY_GUIDE_SECTION_NAMES) {
      if (typeof parsed[name] === "string") out[name] = parsed[name] as string;
    }
    return out;
  } catch {
    return emptySections();
  }
}

function parseSectionVersions(
  json: string
): Record<StudyGuideSectionName, number> {
  try {
    const parsed = JSON.parse(json) as Partial<
      Record<StudyGuideSectionName, number>
    >;
    const out: Record<StudyGuideSectionName, number> = {
      topics: 1,
      keyConcepts: 1,
      definitions: 1,
      workedExamples: 1,
      practiceQuestions: 1,
      flaggedGaps: 1,
    };
    for (const name of STUDY_GUIDE_SECTION_NAMES) {
      if (typeof parsed[name] === "number") out[name] = parsed[name] as number;
    }
    return out;
  } catch {
    return {
      topics: 1,
      keyConcepts: 1,
      definitions: 1,
      workedExamples: 1,
      practiceQuestions: 1,
      flaggedGaps: 1,
    };
  }
}

function studyGuideSubpageTitle(d: Date): string {
  const month = d.toLocaleString("en-US", { month: "short" });
  const day = d.getDate();
  const time = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  return `Study Guide — ${month} ${day} ${time}`;
}

// Build the markdown for a single section block (heading + body or
// placeholder).
function sectionMarkdown(name: StudyGuideSectionName, body: string): string {
  const trimmed = body.trim();
  const content = trimmed.length > 0 ? trimmed : "_[needs review] No content yet for this section._";
  return `## ${SECTION_HEADINGS[name]}\n\n${content}`;
}

const STUDY_GUIDE_PROMPT_PREAMBLE = `You are producing an EXAM-READY study guide from a student's notebook.

ABSOLUTE RULE: If the source material does not clearly support a fact, definition, formula, example, or answer, you MUST emit the literal placeholder \`[needs review]\` instead of guessing. Do not invent content. Do not extrapolate. Hallucination is the worst possible failure here.

Output JSON with EXACTLY these six string fields, each containing markdown:

- "topics": A bulleted list of the major topics covered, ordered as they appeared. One-line each.
- "keyConcepts": The core ideas, principles, and rules — bulleted with brief explanations. Use **bold** for the concept name.
- "definitions": Glossary-style. Each entry as "**Term** — definition." Bullet list.
- "workedExamples": Step-by-step worked examples, with reasoning. Use fenced code blocks for code/math derivations and \`$...$\` / \`$$...$$\` for inline / block math. If no example was clearly worked in the source, emit "[needs review]".
- "practiceQuestions": A numbered list of practice questions covering the material. After each question, on a new line, include "_Answer:_ ..." with the answer. If you cannot derive a confident answer from the source, write "_Answer:_ [needs review]".
- "flaggedGaps": A bulleted list of topics that appear thin or unresolved in the source — places the student should follow up. If nothing is unclear, output "_All material covered appears complete._"

Return STRICT JSON. No commentary, no markdown fences around the JSON.`;

async function callStudyGuideModel(
  corpus: string,
  priorContext: string,
  onlySection?: StudyGuideSectionName
): Promise<{ sections: StudyGuideSections; tokenCount: number }> {
  const OpenAI = (await import("openai")).default;
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const sectionConstraint = onlySection
    ? `\n\nIMPORTANT: For this run, only the "${onlySection}" field will be used. You may still output the other fields (any string is fine; an empty string is acceptable), but invest your effort in "${onlySection}".`
    : "";

  const prompt = `${STUDY_GUIDE_PROMPT_PREAMBLE}${sectionConstraint}\n\n${
    priorContext
      ? `Prior study guides for this notebook (for continuity only — do not just repeat them):\n\n${priorContext}\n\n---\n\n`
      : ""
  }Captured session material (chronological):\n\n${corpus}`;

  const response = await openai.chat.completions.create({
    model: STUDY_GUIDE_MODEL,
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    max_tokens: 4096,
  });
  const content = response.choices[0]?.message?.content?.trim() ?? "";
  const tokenCount = response.usage?.total_tokens ?? 0;
  return { sections: parseSections(content), tokenCount };
}

// Push all six sections to a freshly created subpage. Returns the per-section
// block IDs so we can later regenerate just one section in place.
async function pushStudyGuideToNewSubpage(
  parentNotionPageId: string,
  sections: StudyGuideSections,
  createdAt: Date
): Promise<{
  pageId: string;
  url: string;
  sectionBlockIds: Record<StudyGuideSectionName, string[]>;
  topAnchorBlockId: string;
}> {
  // Create the subpage *empty*, then append a stable placeholder block via
  // `appendBlocksAfter` so we can capture its ID. That ID becomes our
  // permanent "top anchor" — used as the `after` cursor whenever the first
  // section is regenerated, so the new blocks land in the original position
  // (Notion's children API appends to the end if `after` is omitted, which
  // would otherwise push regenerated section 0 to the bottom).
  const sub = await createNotionSubpage(
    parentNotionPageId,
    studyGuideSubpageTitle(createdAt),
    []
  );

  const [topAnchorBlockId] = await appendBlocksAfter(
    sub.pageId,
    null,
    markdownToNotionBlocks(
      "_Generated study guide. Sections follow below._"
    )
  );

  // Append each section in order, recording block IDs per section. We chain
  // every append after the most recent section's last block (or the top
  // anchor for the first section) so ordering is deterministic.
  const sectionBlockIds = {
    topics: [],
    keyConcepts: [],
    definitions: [],
    workedExamples: [],
    practiceQuestions: [],
    flaggedGaps: [],
  } as Record<StudyGuideSectionName, string[]>;

  let cursor: string = topAnchorBlockId;
  for (const name of STUDY_GUIDE_SECTION_NAMES) {
    const blocks = markdownToNotionBlocks(sectionMarkdown(name, sections[name]));
    const ids = await appendBlocksAfter(sub.pageId, cursor, blocks);
    sectionBlockIds[name] = ids;
    if (ids.length > 0) cursor = ids[ids.length - 1];
  }

  return {
    pageId: sub.pageId,
    url: sub.url,
    sectionBlockIds,
    topAnchorBlockId,
  };
}

async function generateStudyGuide(
  notebookId: string,
  inSessionSummaries: InSessionSummaryInput[] = []
): Promise<
  | { ok: true; studyGuide: StudyGuide }
  | { ok: false; reason: string; status: number }
> {
  if (generatingStudyGuide.has(notebookId)) {
    return {
      ok: false,
      reason: "A study guide is already being generated for this notebook.",
      status: 409,
    };
  }
  generatingStudyGuide.add(notebookId);
  try {
    const notebook = await storage.getNotebook(notebookId);
    if (!notebook) return { ok: false, reason: "Notebook not found", status: 404 };
    if (!notebook.notionPageId) {
      return {
        ok: false,
        reason: "Notebook has no synced Notion page yet. Use Send to Notion first.",
        status: 400,
      };
    }

    const corpus = await buildDetailedSummaryCorpus(notebookId, inSessionSummaries);
    if (corpus.trim().length === 0) {
      return {
        ok: false,
        reason: "Notebook has no captured content yet — nothing to build a study guide from.",
        status: 400,
      };
    }

    const prior = await storage.getStudyGuidesByNotebook(notebookId);
    const rawPriorContext = prior
      .slice(0, 2)
      .map((g) => {
        const secs = parseSections(g.sections);
        return `[Prior study guide from ${new Date(g.createdAt).toLocaleString()}]\nTopics: ${secs.topics}\nKey Concepts: ${secs.keyConcepts}`;
      })
      .join("\n\n---\n\n");
    const priorContext = rawPriorContext.slice(0, MAX_PRIOR_CONTEXT_CHARS);

    const { sections, tokenCount } = await callStudyGuideModel(corpus, priorContext);

    const initialVersions: Record<StudyGuideSectionName, number> = {
      topics: 1,
      keyConcepts: 1,
      definitions: 1,
      workedExamples: 1,
      practiceQuestions: 1,
      flaggedGaps: 1,
    };

    const row = await storage.createStudyGuide({
      id: randomUUID(),
      notebookId,
      sections: JSON.stringify(sections),
      sectionVersions: JSON.stringify(initialVersions),
      model: STUDY_GUIDE_MODEL,
      tokenCount,
    });

    try {
      const pushed = await pushStudyGuideToNewSubpage(
        notebook.notionPageId,
        sections,
        new Date(row.createdAt)
      );
      const updated = (await storage.setStudyGuideSubpage(
        row.id,
        pushed.pageId,
        pushed.url,
        pushed.topAnchorBlockId
      )) ?? row;
      // Record per-section block IDs in the Phase-2 mapping table.
      for (const name of STUDY_GUIDE_SECTION_NAMES) {
        await storage.recordStudyGuideSectionBlocks(
          row.id,
          name,
          pushed.sectionBlockIds[name]
        );
      }
      return { ok: true, studyGuide: updated };
    } catch (e) {
      if (e instanceof NotionNotFoundError) {
        // Parent page was deleted in Notion. Per Phase-2 isolation we do NOT
        // touch live-sync state. Leave the row's subpage null so the next
        // generation creates a fresh subpage once live-sync recovers.
        console.warn(
          `Study-guide subpage push hit 404 for notebook ${notebookId}; leaving live-sync state untouched.`
        );
        const cleared = await storage.setStudyGuideSubpage(row.id, null, null);
        await storage.clearStudyGuideBlockMappings(row.id);
        return { ok: true, studyGuide: cleared ?? row };
      }
      console.error("Study-guide Notion push failed:", e);
      return { ok: true, studyGuide: row };
    }
  } finally {
    generatingStudyGuide.delete(notebookId);
  }
}

// Per-section regenerate. Mutates the existing row's section content +
// version, deletes that section's existing Notion blocks, and re-appends new
// ones immediately after the prior section's last block (so ordering is
// preserved on the subpage).
async function regenerateStudyGuideSection(
  studyGuideId: string,
  section: StudyGuideSectionName
): Promise<
  | { ok: true; studyGuide: StudyGuide }
  | { ok: false; reason: string; status: number }
> {
  const guide = await storage.getStudyGuide(studyGuideId);
  if (!guide) return { ok: false, reason: "Study guide not found", status: 404 };
  if (generatingStudyGuide.has(guide.notebookId)) {
    return {
      ok: false,
      reason: "A study guide operation is already in progress for this notebook.",
      status: 409,
    };
  }
  generatingStudyGuide.add(guide.notebookId);
  try {
    const notebook = await storage.getNotebook(guide.notebookId);
    if (!notebook) return { ok: false, reason: "Notebook not found", status: 404 };

    const corpus = await buildDetailedSummaryCorpus(guide.notebookId, []);
    if (corpus.trim().length === 0) {
      return {
        ok: false,
        reason: "Notebook has no captured content to regenerate from.",
        status: 400,
      };
    }

    // Provide the existing section's content as continuity context. The
    // model is still bound by the [needs review] rule.
    const existingSections = parseSections(guide.sections);
    const priorContext = `Existing section "${SECTION_HEADINGS[section]}":\n${existingSections[section] || "(empty)"}`;

    const { sections: newSections, tokenCount } = await callStudyGuideModel(
      corpus,
      priorContext,
      section
    );

    const merged = { ...existingSections, [section]: newSections[section] };
    const versions = parseSectionVersions(guide.sectionVersions);
    versions[section] = (versions[section] ?? 1) + 1;

    const updated = await storage.updateStudyGuideSection(
      guide.id,
      section,
      JSON.stringify(merged),
      JSON.stringify(versions),
      guide.tokenCount + tokenCount
    );

    // Now patch the subpage in place — delete old blocks for this section,
    // append new ones after the previous section's last block.
    if (guide.notionSubpageId) {
      try {
        const oldIds = await storage.getStudyGuideSectionBlocks(guide.id, section);
        for (const id of oldIds) {
          try {
            await deleteNotionBlock(id);
          } catch (err) {
            // Block may already be gone; tolerate that and continue.
            console.warn(`Failed to delete study-guide block ${id}:`, err);
          }
        }

        // Find the anchor: last block of the previous section in display
        // order. If this is the first section (or all preceding sections
        // are empty), fall back to the subpage's stable top anchor block so
        // the new blocks are inserted *immediately after* the placeholder
        // header — preserving the section's original position. If no anchor
        // exists at all (legacy rows), we have to append at the end (this
        // is rare and only affects pre-existing study guides).
        const sectionIdx = STUDY_GUIDE_SECTION_NAMES.indexOf(section);
        let anchor: string | null = guide.topAnchorBlockId ?? null;
        for (let i = sectionIdx - 1; i >= 0; i--) {
          const prev = STUDY_GUIDE_SECTION_NAMES[i];
          const prevIds = await storage.getStudyGuideSectionBlocks(guide.id, prev);
          if (prevIds.length > 0) {
            anchor = prevIds[prevIds.length - 1];
            break;
          }
        }

        const newBlocks = markdownToNotionBlocks(
          sectionMarkdown(section, merged[section])
        );
        const newIds = await appendBlocksAfter(
          guide.notionSubpageId,
          anchor,
          newBlocks
        );
        await storage.recordStudyGuideSectionBlocks(guide.id, section, newIds);
      } catch (e) {
        if (e instanceof NotionNotFoundError) {
          // Subpage gone. Drop our reference; UI will offer a full regenerate.
          console.warn(
            `Study-guide section regenerate hit 404 for guide ${guide.id}; clearing subpage reference.`
          );
          await storage.setStudyGuideSubpage(guide.id, null, null);
          await storage.clearStudyGuideBlockMappings(guide.id);
        } else {
          console.error("Study-guide section regenerate Notion push failed:", e);
        }
      }
    }

    const finalRow = (await storage.getStudyGuide(guide.id)) ?? updated ?? guide;
    return { ok: true, studyGuide: finalRow };
  } finally {
    generatingStudyGuide.delete(guide.notebookId);
  }
}

export async function registerRoutes(app: Express): Promise<Server> {
  const objectStorageService = new ObjectStorageService();
  const transcriptionService = new TranscriptionService();
  const visionService = new VisionService();

  // Serve uploaded objects (public access for this use case)
  app.get("/objects/:objectPath(*)", async (req, res) => {
    try {
      const objectFile = await objectStorageService.getObjectEntityFile(
        req.path,
      );
      objectStorageService.downloadObject(objectFile, res);
    } catch (error) {
      console.error("Error checking object access:", error);
      if (error instanceof ObjectNotFoundError) {
        return res.sendStatus(404);
      }
      return res.sendStatus(500);
    }
  });

  // Get upload URL for a new image
  app.post("/api/objects/upload", async (req, res) => {
    try {
      console.log("Generating upload URL...");
      console.log("PRIVATE_OBJECT_DIR:", process.env.PRIVATE_OBJECT_DIR);
      const uploadURL = await objectStorageService.getObjectEntityUploadURL();
      console.log("Upload URL generated successfully");
      res.json({ uploadURL });
    } catch (error: any) {
      console.error("Error getting upload URL:", error?.message || error);
      console.error("Full error:", JSON.stringify(error, Object.getOwnPropertyNames(error)));
      res.status(500).json({ error: "Failed to get upload URL", details: error?.message });
    }
  });

  // ============ NOTEBOOK ROUTES ============

  // Create notebook
  app.post("/api/notebooks", async (req, res) => {
    try {
      const validatedData = insertNotebookSchema.parse({
        id: randomUUID(),
        ...req.body,
      });
      const notebook = await storage.createNotebook(validatedData);
      res.json(notebook);
    } catch (error) {
      console.error("Error creating notebook:", error);
      res.status(400).json({ error: "Invalid notebook data" });
    }
  });

  // Get all notebooks
  app.get("/api/notebooks", async (req, res) => {
    try {
      const notebooksList = await storage.getAllNotebooks();
      res.json(notebooksList);
    } catch (error) {
      console.error("Error fetching notebooks:", error);
      res.status(500).json({ error: "Failed to fetch notebooks" });
    }
  });

  // Get single notebook
  app.get("/api/notebooks/:id", async (req, res) => {
    try {
      const notebook = await storage.getNotebook(req.params.id);
      if (!notebook) {
        return res.status(404).json({ error: "Notebook not found" });
      }
      res.json({
        ...notebook,
        notionSyncStatus: getSyncStatus(notebook.id),
        notionSyncPending: getSyncQueueLength(notebook.id),
        notionBackfilling: isBackfilling(notebook.id),
        detailedSummaryGenerating: generatingDetailedSummary.has(notebook.id),
        studyGuideGenerating: generatingStudyGuide.has(notebook.id),
      });
    } catch (error) {
      console.error("Error fetching notebook:", error);
      res.status(500).json({ error: "Failed to fetch notebook" });
    }
  });

  // Update notebook
  app.patch("/api/notebooks/:id", async (req, res) => {
    try {
      const { title, className, notionSyncEnabled, sessionEnded, autoDetailedSummaryOnEnd, autoStudyGuideOnEnd, mirrorAttachmentsToNotion } = req.body;
      if (
        !title &&
        className === undefined &&
        notionSyncEnabled === undefined &&
        sessionEnded === undefined &&
        autoDetailedSummaryOnEnd === undefined &&
        autoStudyGuideOnEnd === undefined &&
        mirrorAttachmentsToNotion === undefined
      ) {
        return res.status(400).json({ error: "No fields to update" });
      }
      if (notionSyncEnabled !== undefined && typeof notionSyncEnabled !== "boolean") {
        return res.status(400).json({ error: "notionSyncEnabled must be a boolean" });
      }
      if (sessionEnded !== undefined && typeof sessionEnded !== "boolean") {
        return res.status(400).json({ error: "sessionEnded must be a boolean" });
      }
      if (
        autoDetailedSummaryOnEnd !== undefined &&
        typeof autoDetailedSummaryOnEnd !== "boolean"
      ) {
        return res.status(400).json({ error: "autoDetailedSummaryOnEnd must be a boolean" });
      }
      if (
        autoStudyGuideOnEnd !== undefined &&
        typeof autoStudyGuideOnEnd !== "boolean"
      ) {
        return res.status(400).json({ error: "autoStudyGuideOnEnd must be a boolean" });
      }
      if (
        mirrorAttachmentsToNotion !== undefined &&
        typeof mirrorAttachmentsToNotion !== "boolean"
      ) {
        return res.status(400).json({ error: "mirrorAttachmentsToNotion must be a boolean" });
      }
      const before = await storage.getNotebook(req.params.id);
      const updated = await storage.updateNotebook(req.params.id, {
        title,
        className,
        notionSyncEnabled,
        sessionEnded,
        autoDetailedSummaryOnEnd,
        autoStudyGuideOnEnd,
        mirrorAttachmentsToNotion,
      });
      if (!updated) {
        return res.status(404).json({ error: "Notebook not found" });
      }
      // If title or class actually changed, mirror the rename to Notion.
      if (
        before &&
        (before.title !== updated.title || before.className !== updated.className)
      ) {
        enqueueSync(updated.id, { kind: "rename" });
      }
      // Auto-trigger a detailed summary the moment a session is flipped to
      // ended (and the per-notebook setting is on). Fire-and-forget; failures
      // are reported via the row's own state, not the toggle response.
      if (
        before &&
        !before.sessionEnded &&
        updated.sessionEnded &&
        updated.autoDetailedSummaryOnEnd
      ) {
        setImmediate(() => {
          // Auto-trigger has no access to in-session summary cards (those
          // live in client state). The synthesis still includes OCR,
          // transcripts, checkpoints, and prior detailed summaries.
          generateDetailedSummary(updated.id, []).catch((err) => {
            console.error(
              `Auto detailed-summary on session end failed for ${updated.id}:`,
              err
            );
          });
        });
      }
      // Same auto-trigger pattern for study guides. Independent toggle so
      // the user can opt into one, both, or neither.
      if (
        before &&
        !before.sessionEnded &&
        updated.sessionEnded &&
        updated.autoStudyGuideOnEnd
      ) {
        setImmediate(() => {
          generateStudyGuide(updated.id, []).catch((err) => {
            console.error(
              `Auto study-guide on session end failed for ${updated.id}:`,
              err
            );
          });
        });
      }
      res.json(updated);
    } catch (error) {
      console.error("Error updating notebook:", error);
      res.status(500).json({ error: "Failed to update notebook" });
    }
  });

  // Delete notebook (and all related objects from storage)
  app.delete("/api/notebooks/:id", async (req, res) => {
    try {
      const notebookId = req.params.id;
      
      // First, get all images to clean up object storage
      const imagesList = await storage.getImagesByNotebook(notebookId);
      
      // Delete all objects from cloud storage
      for (const image of imagesList) {
        try {
          const objectFile = await objectStorageService.getObjectEntityFile(image.objectPath);
          await objectFile.delete();
        } catch (error) {
          if (!(error instanceof ObjectNotFoundError)) {
            console.error(`Error deleting object ${image.objectPath}:`, error);
          }
        }
      }
      
      // Delete notebook (cascades to images, transcriptions, checkpoints)
      await storage.deleteNotebook(notebookId);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting notebook:", error);
      res.status(500).json({ error: "Failed to delete notebook" });
    }
  });

  // Get notebook timeline (merged images, transcriptions, checkpoints)
  app.get("/api/notebooks/:id/timeline", async (req, res) => {
    try {
      const notebookId = req.params.id;
      
      const [imagesList, transcriptionsList, checkpointsList] = await Promise.all([
        storage.getImagesByNotebook(notebookId),
        storage.getTranscriptionsByNotebook(notebookId),
        storage.getCheckpointsByNotebook(notebookId),
      ]);

      const timeline: TimelineItem[] = [
        ...imagesList.map((img): TimelineItem => ({
          id: img.id,
          type: "image",
          timestamp: img.uploadedAt,
          content: img,
        })),
        ...transcriptionsList.map((t): TimelineItem => ({
          id: t.id,
          type: "transcription",
          timestamp: t.createdAt,
          content: t,
        })),
        ...checkpointsList.map((c): TimelineItem => ({
          id: c.id,
          type: "checkpoint",
          timestamp: c.createdAt,
          content: c,
        })),
      ];

      // Sort by timestamp ascending (oldest first)
      timeline.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

      res.json(timeline);
    } catch (error) {
      console.error("Error fetching timeline:", error);
      res.status(500).json({ error: "Failed to fetch timeline" });
    }
  });

  // ============ IMAGE ROUTES ============

  // Create image record
  app.post("/api/images", async (req, res) => {
    try {
      const validatedData = insertImageSchema.parse(req.body);
      const image = await storage.createImage(validatedData);
      res.json(image);

      const baseUrl = `${req.protocol}://${req.get("host")}`;
      // Live Notion sync for the image
      enqueueSync(image.notebookId, { kind: "image", content: image, baseUrl });

      // Trigger background OCR (non-blocking)
      const imageUrl = `${baseUrl}${image.objectPath}`;
      visionService.extractTextFromUrl(imageUrl).then(async (ocrText) => {
        await storage.updateImageOcr(image.id, ocrText);
        if (ocrText && ocrText.trim().length > 0) {
          enqueueSync(image.notebookId, {
            kind: "ocrText",
            imageId: image.id,
            imageFileName: image.fileName,
            text: ocrText,
          });
        }
      }).catch((err) => {
        console.error(`Background OCR failed for image ${image.id}:`, err);
      });
    } catch (error) {
      console.error("Error creating image:", error);
      res.status(400).json({ error: "Invalid image data" });
    }
  });

  // Manual OCR scan for a single image
  app.post("/api/images/:id/ocr", async (req, res) => {
    try {
      const image = await storage.getImage(req.params.id);
      if (!image) {
        return res.status(404).json({ error: "Image not found" });
      }

      const imageUrl = `${req.protocol}://${req.get("host")}${image.objectPath}`;
      const ocrText = await visionService.extractTextFromUrl(imageUrl);
      const updated = await storage.updateImageOcr(image.id, ocrText);
      if (ocrText && ocrText.trim().length > 0) {
        enqueueSync(image.notebookId, {
          kind: "ocrText",
          imageId: image.id,
          imageFileName: image.fileName,
          text: ocrText,
        });
      }
      res.json(updated);
    } catch (error) {
      console.error("Error running OCR:", error);
      res.status(500).json({ error: "Failed to run OCR" });
    }
  });

  // Batch-scan all images in a notebook that have no ocrText
  app.post("/api/notebooks/:id/ocr-all", async (req, res) => {
    try {
      const imagesList = await storage.getImagesByNotebook(req.params.id);
      const unscanned = imagesList.filter((img) => !img.ocrText);

      res.json({ total: unscanned.length, queued: true });

      // Process in background, sequentially to avoid rate limits
      (async () => {
        for (const img of unscanned) {
          try {
            const imageUrl = `${req.protocol}://${req.get("host")}${img.objectPath}`;
            const ocrText = await visionService.extractTextFromUrl(imageUrl);
            await storage.updateImageOcr(img.id, ocrText);
            if (ocrText && ocrText.trim().length > 0) {
              enqueueSync(img.notebookId, {
                kind: "ocrText",
                imageId: img.id,
                imageFileName: img.fileName,
                text: ocrText,
              });
            }
          } catch (err) {
            console.error(`Batch OCR failed for image ${img.id}:`, err);
          }
        }
      })();
    } catch (error) {
      console.error("Error running batch OCR:", error);
      res.status(500).json({ error: "Failed to run batch OCR" });
    }
  });

  // Get all images
  app.get("/api/images", async (req, res) => {
    try {
      const imagesList = await storage.getAllImages();
      res.json(imagesList);
    } catch (error) {
      console.error("Error fetching images:", error);
      res.status(500).json({ error: "Failed to fetch images" });
    }
  });

  // Get single image
  app.get("/api/images/:id", async (req, res) => {
    try {
      const image = await storage.getImage(req.params.id);
      if (!image) {
        return res.status(404).json({ error: "Image not found" });
      }
      res.json(image);
    } catch (error) {
      console.error("Error fetching image:", error);
      res.status(500).json({ error: "Failed to fetch image" });
    }
  });

  // Delete image
  app.delete("/api/images/:id", async (req, res) => {
    try {
      const image = await storage.getImage(req.params.id);
      if (!image) {
        return res.status(404).json({ error: "Image not found" });
      }

      // Delete the actual object from cloud storage first
      try {
        const objectFile = await objectStorageService.getObjectEntityFile(image.objectPath);
        await objectFile.delete();
      } catch (error) {
        if (!(error instanceof ObjectNotFoundError)) {
          console.error("Error deleting object:", error);
        }
      }

      await storage.deleteImage(req.params.id);
      // Mirror the delete to the synced Notion page (image block + any OCR blocks).
      enqueueSync(image.notebookId, { kind: "delete", targetKind: "image", localId: image.id });
      enqueueSync(image.notebookId, { kind: "delete", targetKind: "ocr", localId: image.id });
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting image:", error);
      res.status(500).json({ error: "Failed to delete image" });
    }
  });

  // Delete all images (deprecated - use notebook delete instead)
  app.delete("/api/images", async (req, res) => {
    try {
      // This route is deprecated - notebooks handle cleanup via cascade
      res.status(400).json({ 
        error: "Use DELETE /api/notebooks/:id instead to delete a notebook and all its content" 
      });
    } catch (error) {
      console.error("Error deleting all images:", error);
      res.status(500).json({ error: "Failed to delete all images" });
    }
  });

  // ============ TRANSCRIPTION ROUTES ============

  // Create transcription record
  app.post("/api/transcriptions", async (req, res) => {
    try {
      const validatedData = insertTranscriptionSchema.parse(req.body);
      const transcription = await storage.createTranscription(validatedData);
      enqueueSync(transcription.notebookId, { kind: "transcription", content: transcription });
      res.json(transcription);
    } catch (error) {
      console.error("Error creating transcription:", error);
      res.status(400).json({ error: "Invalid transcription data" });
    }
  });

  // Get all transcriptions
  app.get("/api/transcriptions", async (req, res) => {
    try {
      const transcriptionsList = await storage.getAllTranscriptions();
      res.json(transcriptionsList);
    } catch (error) {
      console.error("Error fetching transcriptions:", error);
      res.status(500).json({ error: "Failed to fetch transcriptions" });
    }
  });

  // Update transcription text
  app.patch("/api/transcriptions/:id", async (req, res) => {
    try {
      const { text } = req.body as { text?: unknown };
      if (typeof text !== "string" || text.trim().length === 0) {
        return res.status(400).json({ error: "text is required" });
      }
      const updated = await storage.updateTranscription(req.params.id, text);
      if (!updated) {
        return res.status(404).json({ error: "Transcription not found" });
      }
      enqueueSync(updated.notebookId, {
        kind: "edit",
        targetKind: "transcription",
        content: updated,
      });
      res.json(updated);
    } catch (error) {
      console.error("Error updating transcription:", error);
      res.status(500).json({ error: "Failed to update transcription" });
    }
  });

  // Delete transcription
  app.delete("/api/transcriptions/:id", async (req, res) => {
    try {
      const existing = await storage.getTranscription(req.params.id);
      await storage.deleteTranscription(req.params.id);
      if (existing) {
        enqueueSync(existing.notebookId, {
          kind: "delete",
          targetKind: "transcription",
          localId: existing.id,
        });
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting transcription:", error);
      res.status(500).json({ error: "Failed to delete transcription" });
    }
  });

  // Delete all transcriptions
  app.delete("/api/transcriptions", async (req, res) => {
    try {
      await storage.deleteAllTranscriptions();
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting all transcriptions:", error);
      res.status(500).json({ error: "Failed to delete all transcriptions" });
    }
  });

  // Transcribe audio
  app.post("/api/transcribe", async (req, res) => {
    let tempFilePath: string | null = null;
    
    try {
      if (!req.body.audio) {
        return res.status(400).json({ error: "No audio data provided" });
      }

      const { audio, notebookId } = req.body;
      
      if (!notebookId) {
        return res.status(400).json({ error: "notebookId is required" });
      }

      // Convert base64 audio to buffer
      const audioBuffer = Buffer.from(audio, "base64");
      const filename = `audio-${Date.now()}.webm`;
      
      // Save audio temporarily
      tempFilePath = await transcriptionService.saveAudioBuffer(audioBuffer, filename);
      
      // Transcribe audio
      const result = await transcriptionService.transcribeAudio(tempFilePath);
      
      // Create transcription record
      const transcription = await storage.createTranscription({
        id: randomUUID(),
        text: result.text,
        notebookId,
      });

      enqueueSync(notebookId, { kind: "transcription", content: transcription });

      res.json(transcription);
    } catch (error) {
      console.error("Error transcribing audio:", error);
      res.status(500).json({ error: "Failed to transcribe audio" });
    } finally {
      if (tempFilePath) {
        await transcriptionService.cleanup(tempFilePath);
      }
    }
  });

  // ============ CHECKPOINT ROUTES ============

  // Create checkpoint
  app.post("/api/checkpoints", async (req, res) => {
    try {
      const validatedData = insertCheckpointSchema.parse({
        id: randomUUID(),
        ...req.body,
      });
      const checkpoint = await storage.createCheckpoint(validatedData);
      enqueueSync(checkpoint.notebookId, { kind: "checkpoint", content: checkpoint });
      res.json(checkpoint);
    } catch (error) {
      console.error("Error creating checkpoint:", error);
      res.status(400).json({ error: "Invalid checkpoint data" });
    }
  });

  // Get checkpoints by notebook
  app.get("/api/notebooks/:id/checkpoints", async (req, res) => {
    try {
      const checkpointsList = await storage.getCheckpointsByNotebook(req.params.id);
      res.json(checkpointsList);
    } catch (error) {
      console.error("Error fetching checkpoints:", error);
      res.status(500).json({ error: "Failed to fetch checkpoints" });
    }
  });

  // Update checkpoint label
  app.patch("/api/checkpoints/:id", async (req, res) => {
    try {
      const { label } = req.body as { label?: unknown };
      if (label !== null && typeof label !== "string") {
        return res.status(400).json({ error: "label must be a string or null" });
      }
      const updated = await storage.updateCheckpoint(
        req.params.id,
        label === null ? null : (label as string)
      );
      if (!updated) {
        return res.status(404).json({ error: "Checkpoint not found" });
      }
      enqueueSync(updated.notebookId, {
        kind: "edit",
        targetKind: "checkpoint",
        content: updated,
      });
      res.json(updated);
    } catch (error) {
      console.error("Error updating checkpoint:", error);
      res.status(500).json({ error: "Failed to update checkpoint" });
    }
  });

  // Delete checkpoint
  app.delete("/api/checkpoints/:id", async (req, res) => {
    try {
      const existing = await storage.getCheckpoint(req.params.id);
      await storage.deleteCheckpoint(req.params.id);
      if (existing) {
        enqueueSync(existing.notebookId, {
          kind: "delete",
          targetKind: "checkpoint",
          localId: existing.id,
        });
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting checkpoint:", error);
      res.status(500).json({ error: "Failed to delete checkpoint" });
    }
  });

  // Delete a summary card from the synced Notion page. Summaries are not
  // persisted server-side, so the client passes the summary ID generated at
  // creation time and the corresponding Notion blocks (tracked in
  // notion_block_mappings) are removed.
  app.delete("/api/notebooks/:notebookId/summaries/:summaryId", async (req, res) => {
    try {
      const { notebookId, summaryId } = req.params;
      const notebook = await storage.getNotebook(notebookId);
      if (!notebook) {
        return res.status(404).json({ error: "Notebook not found" });
      }
      enqueueSync(notebookId, {
        kind: "delete",
        targetKind: "summary",
        localId: summaryId,
      });
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting summary:", error);
      res.status(500).json({ error: "Failed to delete summary" });
    }
  });

  // Backfill historical items into the live-synced Notion page. Idempotent
  // (skips items already mapped or already queued) and serialized per
  // notebook so concurrent calls cannot enqueue duplicates.
  app.post("/api/notebooks/:id/notion/backfill", async (req, res) => {
    try {
      const notebookId = req.params.id;
      const baseUrl = `${req.protocol}://${req.get("host")}`;
      const result = await backfillNotebook(notebookId, baseUrl);
      if (!result.ok) {
        if (result.reason === "not-found") {
          return res.status(404).json({ error: "Notebook not found" });
        }
        if (result.reason === "no-page") {
          return res.status(400).json({
            error: "Notebook has no live-synced Notion page. Use Send to Notion first.",
          });
        }
        if (result.reason === "already-running") {
          return res.status(409).json({ error: "A backfill is already in progress for this notebook." });
        }
      } else {
        return res.json({ queued: result.queued });
      }
    } catch (error: any) {
      console.error("Error backfilling to Notion:", error);
      res.status(500).json({ error: error?.message || "Failed to backfill to Notion" });
    }
  });

  // ============ DETAILED SUMMARY ROUTES (Phase 2) ============

  // Generate a new detailed summary for a notebook (versioned, never overwrites).
  app.post("/api/notebooks/:id/detailed-summaries", async (req, res) => {
    try {
      const body = (req.body ?? {}) as { inSessionSummaries?: unknown };
      let inSession: InSessionSummaryInput[] = [];
      if (Array.isArray(body.inSessionSummaries)) {
        inSession = body.inSessionSummaries
          .filter(
            (s): s is { text: unknown; timestamp: unknown } =>
              typeof s === "object" && s !== null
          )
          .map((s) => ({
            text: typeof s.text === "string" ? s.text : "",
            timestamp:
              typeof s.timestamp === "string" || s.timestamp instanceof Date
                ? (s.timestamp as string | Date)
                : new Date(),
          }))
          .filter((s) => s.text.trim().length > 0);
      }
      const result = await generateDetailedSummary(req.params.id, inSession);
      if (!result.ok) {
        return res.status(result.status).json({ error: result.reason });
      }
      res.json(result.summary);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to generate detailed summary";
      console.error("Detailed summary generation failed:", error);
      res.status(500).json({ error: message });
    }
  });

  // List all detailed summaries for a notebook (newest first).
  app.get("/api/notebooks/:id/detailed-summaries", async (req, res) => {
    try {
      const summaries = await storage.getDetailedSummariesByNotebook(req.params.id);
      res.json(summaries);
    } catch (error) {
      console.error("Error listing detailed summaries:", error);
      res.status(500).json({ error: "Failed to list detailed summaries" });
    }
  });

  // ============ STUDY GUIDE ROUTES (Phase 2) ============

  // Generate a new study guide (creates a new versioned row + Notion subpage).
  app.post("/api/notebooks/:id/study-guides", async (req, res) => {
    try {
      const raw: unknown = req.body?.inSessionSummaries;
      const inSession: InSessionSummaryInput[] = Array.isArray(raw)
        ? raw.flatMap((entry): InSessionSummaryInput[] => {
            if (
              entry &&
              typeof entry === "object" &&
              "text" in entry &&
              typeof (entry as { text: unknown }).text === "string"
            ) {
              const text = (entry as { text: string }).text;
              if (text.trim().length === 0) return [];
              const ts = (entry as { timestamp?: unknown }).timestamp;
              const timestamp =
                typeof ts === "string" || ts instanceof Date ? ts : new Date();
              return [{ text, timestamp }];
            }
            return [];
          })
        : [];
      const result = await generateStudyGuide(req.params.id, inSession);
      if (!result.ok) {
        return res.status(result.status).json({ error: result.reason });
      }
      res.json(result.studyGuide);
    } catch (error) {
      console.error("Error generating study guide:", error);
      res.status(500).json({ error: "Failed to generate study guide" });
    }
  });

  // List study guides for a notebook (newest first).
  app.get("/api/notebooks/:id/study-guides", async (req, res) => {
    try {
      const guides = await storage.getStudyGuidesByNotebook(req.params.id);
      res.json(guides);
    } catch (error) {
      console.error("Error listing study guides:", error);
      res.status(500).json({ error: "Failed to list study guides" });
    }
  });

  // Per-section regenerate. Updates this section in place on the existing
  // subpage (delete + re-append at original ordinal position).
  app.post("/api/study-guides/:id/sections/:section/regenerate", async (req, res) => {
    try {
      const section = req.params.section as StudyGuideSectionName;
      if (!STUDY_GUIDE_SECTION_NAMES.includes(section)) {
        return res.status(400).json({ error: "Invalid section name" });
      }
      const result = await regenerateStudyGuideSection(req.params.id, section);
      if (!result.ok) {
        return res.status(result.status).json({ error: result.reason });
      }
      res.json(result.studyGuide);
    } catch (error) {
      console.error("Error regenerating study-guide section:", error);
      res.status(500).json({ error: "Failed to regenerate section" });
    }
  });

  // Update reviewed-items list. UI-only state; never pushed to Notion (so
  // Notion doesn't drift away from the originally generated content).
  app.patch("/api/study-guides/:id/reviewed", async (req, res) => {
    try {
      const items = req.body?.reviewedItems;
      if (!Array.isArray(items) || !items.every((s) => typeof s === "string")) {
        return res.status(400).json({ error: "reviewedItems must be string[]" });
      }
      const updated = await storage.setStudyGuideReviewedItems(req.params.id, items);
      if (!updated) return res.status(404).json({ error: "Study guide not found" });
      res.json(updated);
    } catch (error) {
      console.error("Error updating reviewed items:", error);
      res.status(500).json({ error: "Failed to update reviewed items" });
    }
  });

  // ============ NOTION EXPORT ROUTE ============

  // List accessible Notion pages for parent page selection
  app.get("/api/notion/pages", async (_req, res) => {
    try {
      const pages = await listNotionPages();
      res.json(pages);
    } catch (error: any) {
      console.error("Error listing Notion pages:", error);
      res.status(500).json({ error: error?.message || "Failed to list Notion pages" });
    }
  });

  // Export notebook to Notion
  app.post("/api/notebooks/:id/export/notion", async (req, res) => {
    try {
      const notebookId = req.params.id;

      const notebook = await storage.getNotebook(notebookId);
      if (!notebook) {
        return res.status(404).json({ error: "Notebook not found" });
      }

      // If a live-synced page already exists, return it instead of creating a duplicate.
      if (notebook.notionPageId) {
        const pid = notebook.notionPageId.replace(/-/g, "");
        return res.json({
          url: `https://www.notion.so/${pid}`,
          pageId: notebook.notionPageId,
          alreadySynced: true,
        });
      }

      const [imagesList, transcriptionsList, checkpointsList] = await Promise.all([
        storage.getImagesByNotebook(notebookId),
        storage.getTranscriptionsByNotebook(notebookId),
        storage.getCheckpointsByNotebook(notebookId),
      ]);

      const timeline: TimelineItem[] = [
        ...imagesList.map((img): TimelineItem => ({
          id: img.id,
          type: "image",
          timestamp: img.uploadedAt,
          content: img,
        })),
        ...transcriptionsList.map((t): TimelineItem => ({
          id: t.id,
          type: "transcription",
          timestamp: t.createdAt,
          content: t,
        })),
        ...checkpointsList.map((c): TimelineItem => ({
          id: c.id,
          type: "checkpoint",
          timestamp: c.createdAt,
          content: c,
        })),
      ];

      timeline.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

      const baseUrl = `${req.protocol}://${req.get("host")}`;

      const { parentPageId, includeDescriptions } = req.body as {
        parentPageId?: string | null;
        includeDescriptions?: boolean;
      };

      const result = await exportNotebookToNotion(
        notebook.title,
        notebook.className,
        notebook.createdAt,
        timeline,
        baseUrl,
        parentPageId ?? null,
        includeDescriptions !== false
      );

      res.json({ url: result.url, pageId: result.pageId });
    } catch (error: any) {
      console.error("Error exporting to Notion:", error);
      res.status(500).json({ error: error?.message || "Failed to export to Notion" });
    }
  });

  // AI summary endpoint
  app.post("/api/summary", async (req, res) => {
    const { entries, notebookId, summaryId } = req.body as {
      entries: Array<{ text: string; timestamp: string }>;
      notebookId?: string;
      summaryId?: string;
    };
    if (!entries || entries.length === 0) {
      return res.status(400).json({ error: "No entries provided" });
    }
    try {
      const OpenAI = (await import("openai")).default;
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const formatted = entries.map(e => `[${e.timestamp}] ${e.text}`).join("\n\n");
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{
          role: "user",
          content: `You are summarizing lecture notes captured at specific timestamps. Create a concise, well-structured summary in markdown format.

Guidelines:
- Use **bold** for key terms and concepts
- Use bullet points for lists and definitions
- Use inline math $...$ for formulas (e.g., $E=mc^2$) and block math $$...$$ for equations
- Use \`code\` for short code snippets and triple-backtick code blocks with language for multi-line code
- Use ## headings only if multiple clearly distinct topics are present
- Be concise but complete — focus on what's most important for studying

Entries to summarize:
${formatted}`,
        }],
        max_tokens: 1024,
      });
      const summary = response.choices[0]?.message?.content?.trim() ?? "";
      const finalSummaryId = summaryId || randomUUID();
      if (notebookId && summary) {
        enqueueSync(notebookId, {
          kind: "summary",
          id: finalSummaryId,
          text: summary,
          timestamp: new Date(),
        });
      }
      res.json({ summary, summaryId: finalSummaryId });
    } catch (error: any) {
      console.error("Summary generation error:", error);
      // Fallback: simple extractive summary
      const bullets = entries
        .map(e => `- ${e.text.split(/[.\n]/)[0].trim()}`)
        .filter(b => b.length > 2)
        .slice(0, 6)
        .join("\n");
      const fallback = `**Summary**\n\n${bullets || "No content to summarize."}`;
      const finalSummaryId = summaryId || randomUUID();
      if (notebookId) {
        enqueueSync(notebookId, {
          kind: "summary",
          id: finalSummaryId,
          text: fallback,
          timestamp: new Date(),
        });
      }
      res.json({ summary: fallback, summaryId: finalSummaryId });
    }
  });

  // ============ ATTACHMENT ROUTES ============

  // List attachments for a notebook
  app.get("/api/notebooks/:id/attachments", async (req, res) => {
    try {
      const attachmentsList = await storage.getAttachmentsByNotebook(req.params.id);
      res.json(attachmentsList);
    } catch (error) {
      console.error("Error fetching attachments:", error);
      res.status(500).json({ error: "Failed to fetch attachments" });
    }
  });

  // Create attachment record (after the file has been uploaded to object storage)
  app.post("/api/notebooks/:id/attachments", async (req, res) => {
    try {
      const notebookId = req.params.id;
      const notebook = await storage.getNotebook(notebookId);
      if (!notebook) return res.status(404).json({ error: "Notebook not found" });

      const validatedData = insertAttachmentSchema.parse({
        id: randomUUID(),
        notebookId,
        ...req.body,
      });
      const attachment = await storage.createAttachment(validatedData);
      res.json(attachment);

      // Kick off Notion mirroring asynchronously (best-effort)
      const baseUrl = `${req.protocol}://${req.get("host")}`;
      enqueueAttachmentSync(
        notebookId,
        { kind: "upsert", attachmentId: attachment.id },
        baseUrl
      );
    } catch (error) {
      console.error("Error creating attachment:", error);
      res.status(400).json({ error: "Invalid attachment data" });
    }
  });

  // Update attachment link (link to a specific timeline item)
  app.patch("/api/attachments/:id/link", async (req, res) => {
    try {
      const attachment = await storage.getAttachment(req.params.id);
      if (!attachment) return res.status(404).json({ error: "Attachment not found" });

      const { linkedToType, linkedToId } = req.body;

      // Validate linkedToType against the allowed enum values (null is allowed to clear a link)
      if (linkedToType != null && !(ATTACHMENT_LINK_TYPES as readonly string[]).includes(linkedToType)) {
        return res.status(400).json({ error: `Invalid linkedToType: ${linkedToType}` });
      }

      const updated = await storage.updateAttachmentLink(
        req.params.id,
        linkedToType ?? null,
        linkedToId ?? null
      );
      res.json(updated);

      // Re-mirror to Notion to reflect the link change
      const baseUrl = `${req.protocol}://${req.get("host")}`;
      enqueueAttachmentSync(
        attachment.notebookId,
        { kind: "upsert", attachmentId: attachment.id },
        baseUrl
      );
    } catch (error) {
      console.error("Error updating attachment link:", error);
      res.status(500).json({ error: "Failed to update attachment link" });
    }
  });

  // Delete an attachment
  app.delete("/api/attachments/:id", async (req, res) => {
    try {
      const attachment = await storage.getAttachment(req.params.id);
      if (!attachment) return res.status(404).json({ error: "Attachment not found" });

      const { notebookId, objectPath } = attachment;

      // Fetch notion block ID from the separate mapping table before deleting the row
      const notionBlockId = await storage.getAttachmentNotionBlockId(req.params.id);

      // Delete from object storage
      try {
        const objectFile = await objectStorageService.getObjectEntityFile(objectPath);
        await objectFile.delete();
      } catch (e) {
        if (!(e instanceof ObjectNotFoundError)) {
          console.error(`Error deleting attachment object ${objectPath}:`, e);
        }
      }

      // Delete the DB record first (cascades to attachment_block_mappings) so UI updates immediately
      await storage.deleteAttachment(req.params.id);
      res.json({ success: true });

      // Enqueue Notion block deletion (best-effort, fire-and-forget)
      if (notionBlockId) {
        const baseUrl = `${req.protocol}://${req.get("host")}`;
        enqueueAttachmentSync(
          notebookId,
          { kind: "delete", attachmentId: req.params.id, notionBlockId },
          baseUrl
        );
      }
    } catch (error) {
      console.error("Error deleting attachment:", error);
      res.status(500).json({ error: "Failed to delete attachment" });
    }
  });

  const httpServer = createServer(app);

  return httpServer;
}
