import { pgTable, text, varchar, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { relations } from "drizzle-orm";

// Notebooks schema - the spine of the app
export const notebooks = pgTable("notebooks", {
  id: varchar("id").primaryKey(),
  title: text("title").notNull(),
  className: text("class_name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  notionPageId: text("notion_page_id"),
  notionSyncError: text("notion_sync_error"),
  notionSyncEnabled: boolean("notion_sync_enabled").notNull().default(true),
  // Phase 2: session lifecycle. When a session is "ended" the in-session
  // auto-summary timer stops firing for this notebook.
  sessionEnded: boolean("session_ended").notNull().default(false),
  // Phase 2: when true, marking a notebook ended auto-triggers a single
  // detailed-summary generation.
  autoDetailedSummaryOnEnd: boolean("auto_detailed_summary_on_end").notNull().default(false),
  // Phase 2: when true, marking a notebook ended auto-triggers a single
  // study-guide generation as well.
  autoStudyGuideOnEnd: boolean("auto_study_guide_on_end").notNull().default(false),
});

export const insertNotebookSchema = createInsertSchema(notebooks).omit({
  createdAt: true,
  notionPageId: true,
  notionSyncError: true,
  sessionEnded: true,
  autoDetailedSummaryOnEnd: true,
  autoStudyGuideOnEnd: true,
});

export type InsertNotebook = z.infer<typeof insertNotebookSchema>;
export type Notebook = typeof notebooks.$inferSelect;

// Image schema for uploaded images
export const images = pgTable("images", {
  id: varchar("id").primaryKey(),
  notebookId: varchar("notebook_id").references(() => notebooks.id, { onDelete: "cascade" }).notNull(),
  objectPath: text("object_path").notNull(),
  fileName: text("file_name").notNull(),
  fileSize: text("file_size").notNull(),
  mimeType: text("mime_type").notNull(),
  uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
  ocrText: text("ocr_text"),
});

export const insertImageSchema = createInsertSchema(images).omit({
  uploadedAt: true,
});

export type InsertImage = z.infer<typeof insertImageSchema>;
export type Image = typeof images.$inferSelect;

// Transcription schema for audio transcriptions
export const transcriptions = pgTable("transcriptions", {
  id: varchar("id").primaryKey(),
  notebookId: varchar("notebook_id").references(() => notebooks.id, { onDelete: "cascade" }).notNull(),
  text: text("text").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertTranscriptionSchema = createInsertSchema(transcriptions).omit({
  createdAt: true,
});

export type InsertTranscription = z.infer<typeof insertTranscriptionSchema>;
export type Transcription = typeof transcriptions.$inferSelect;

// Checkpoints schema
export const checkpoints = pgTable("checkpoints", {
  id: varchar("id").primaryKey(),
  notebookId: varchar("notebook_id").references(() => notebooks.id, { onDelete: "cascade" }).notNull(),
  label: text("label"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertCheckpointSchema = createInsertSchema(checkpoints).omit({
  createdAt: true,
});

export type InsertCheckpoint = z.infer<typeof insertCheckpointSchema>;
export type Checkpoint = typeof checkpoints.$inferSelect;

// Relations
export const notebooksRelations = relations(notebooks, ({ many }) => ({
  images: many(images),
  transcriptions: many(transcriptions),
  checkpoints: many(checkpoints),
}));

export const imagesRelations = relations(images, ({ one }) => ({
  notebook: one(notebooks, {
    fields: [images.notebookId],
    references: [notebooks.id],
  }),
}));

export const transcriptionsRelations = relations(transcriptions, ({ one }) => ({
  notebook: one(notebooks, {
    fields: [transcriptions.notebookId],
    references: [notebooks.id],
  }),
}));

export const checkpointsRelations = relations(checkpoints, ({ one }) => ({
  notebook: one(notebooks, {
    fields: [checkpoints.notebookId],
    references: [notebooks.id],
  }),
}));

// Mapping from local items (image/transcription/checkpoint/ocr/summary) to
// the Notion block IDs that represent them on the synced page. Used to mirror
// edits/deletes (and re-runs of OCR) back to Notion instead of duplicating.
export const notionBlockMappings = pgTable("notion_block_mappings", {
  id: varchar("id").primaryKey(),
  notebookId: varchar("notebook_id")
    .references(() => notebooks.id, { onDelete: "cascade" })
    .notNull(),
  localId: text("local_id").notNull(),
  kind: text("kind").notNull(),
  blockIds: text("block_ids").array().notNull(),
});

export type NotionBlockMapping = typeof notionBlockMappings.$inferSelect;

export const notionBlockMappingsRelations = relations(notionBlockMappings, ({ one }) => ({
  notebook: one(notebooks, {
    fields: [notionBlockMappings.notebookId],
    references: [notebooks.id],
  }),
}));

// ============================================================================
// PHASE 2: Detailed Summaries
// ----------------------------------------------------------------------------
// Detailed (post-class) summaries are versioned, never overwritten. Each
// generation creates a new row and a brand-new Notion subpage under the
// synced notebook page. Block IDs are tracked in a SEPARATE mapping table
// (`detailedSummaryBlockMappings`) so the live-sync engine in
// `server/notionSync.ts` can never accidentally touch them.
// ============================================================================
export const detailedSummaries = pgTable("detailed_summaries", {
  id: varchar("id").primaryKey(),
  notebookId: varchar("notebook_id")
    .references(() => notebooks.id, { onDelete: "cascade" })
    .notNull(),
  content: text("content").notNull(),
  model: text("model").notNull(),
  tokenCount: integer("token_count").notNull().default(0),
  notionSubpageId: text("notion_subpage_id"),
  notionSubpageUrl: text("notion_subpage_url"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertDetailedSummarySchema = createInsertSchema(detailedSummaries).omit({
  createdAt: true,
  notionSubpageId: true,
  notionSubpageUrl: true,
});

export type InsertDetailedSummary = z.infer<typeof insertDetailedSummarySchema>;
export type DetailedSummary = typeof detailedSummaries.$inferSelect;

export const detailedSummariesRelations = relations(detailedSummaries, ({ one }) => ({
  notebook: one(notebooks, {
    fields: [detailedSummaries.notebookId],
    references: [notebooks.id],
  }),
}));

// Phase-2 block mapping. Lives in its own table — explicitly NOT
// `notion_block_mappings` — so the live-sync delete/update paths can never
// reach these blocks. See the architectural guard in `server/notionSync.ts`.
export const detailedSummaryBlockMappings = pgTable("detailed_summary_block_mappings", {
  id: varchar("id").primaryKey(),
  detailedSummaryId: varchar("detailed_summary_id")
    .references(() => detailedSummaries.id, { onDelete: "cascade" })
    .notNull(),
  blockIds: text("block_ids").array().notNull(),
});

export type DetailedSummaryBlockMapping = typeof detailedSummaryBlockMappings.$inferSelect;

// ============================================================================
// PHASE 2: Study Guides (exam-ready)
// ----------------------------------------------------------------------------
// Same architectural pattern as Detailed Summaries: versioned, never
// overwritten, pushed to a dedicated Notion subpage. Block IDs live in
// `studyGuideBlockMappings` (NOT `notion_block_mappings`). Per-section
// regeneration uses the section_name column to delete+re-append only the
// blocks for one section.
// ============================================================================
export const STUDY_GUIDE_SECTION_NAMES = [
  "topics",
  "keyConcepts",
  "definitions",
  "workedExamples",
  "practiceQuestions",
  "flaggedGaps",
] as const;

export type StudyGuideSectionName = (typeof STUDY_GUIDE_SECTION_NAMES)[number];

// Persisted as JSON on the row. Each value is markdown.
export type StudyGuideSections = Record<StudyGuideSectionName, string>;

export const studyGuides = pgTable("study_guides", {
  id: varchar("id").primaryKey(),
  notebookId: varchar("notebook_id")
    .references(() => notebooks.id, { onDelete: "cascade" })
    .notNull(),
  // JSON-encoded StudyGuideSections — sectioned content so each section
  // can be regenerated independently.
  sections: text("sections").notNull(),
  // JSON-encoded Record<StudyGuideSectionName, number>. Section-level
  // version counters bump on each per-section regenerate.
  sectionVersions: text("section_versions").notNull().default("{}"),
  // User-marked "reviewed" item IDs (local UI only — not pushed to Notion
  // to avoid drift). Item IDs are stable hashes the renderer assigns to
  // each [needs review] flagged item.
  reviewedItems: text("reviewed_items").array().notNull().default([]),
  model: text("model").notNull(),
  tokenCount: integer("token_count").notNull().default(0),
  notionSubpageId: text("notion_subpage_id"),
  notionSubpageUrl: text("notion_subpage_url"),
  // Stable Notion block ID of the placeholder block at the very top of the
  // subpage. Used as the `after` anchor when regenerating the *first*
  // section so its blocks land in their original position (Notion's API
  // appends to the end when no `after` is provided).
  topAnchorBlockId: text("top_anchor_block_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type StudyGuide = typeof studyGuides.$inferSelect;

export const studyGuidesRelations = relations(studyGuides, ({ one }) => ({
  notebook: one(notebooks, {
    fields: [studyGuides.notebookId],
    references: [notebooks.id],
  }),
}));

// One row per (study_guide, section) so we can delete + re-append the
// blocks for just one section on a per-section regenerate. Strict isolation
// from `notion_block_mappings` — see notionSync.ts isolation guard.
export const studyGuideBlockMappings = pgTable("study_guide_block_mappings", {
  id: varchar("id").primaryKey(),
  studyGuideId: varchar("study_guide_id")
    .references(() => studyGuides.id, { onDelete: "cascade" })
    .notNull(),
  sectionName: text("section_name").notNull(),
  // Ordered Notion block IDs for this section. We track them so per-section
  // regenerate can delete the old blocks and re-append in place using the
  // last block of the prior section as the `after` anchor.
  blockIds: text("block_ids").array().notNull(),
});

export type StudyGuideBlockMapping = typeof studyGuideBlockMappings.$inferSelect;

// Timeline item type for unified view
export type TimelineItem = {
  id: string;
  type: "image" | "transcription" | "checkpoint";
  timestamp: Date;
  content: Image | Transcription | Checkpoint;
};
