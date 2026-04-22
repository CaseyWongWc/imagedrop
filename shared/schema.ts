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
});

export const insertNotebookSchema = createInsertSchema(notebooks).omit({
  createdAt: true,
  notionPageId: true,
  notionSyncError: true,
  sessionEnded: true,
  autoDetailedSummaryOnEnd: true,
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

// Timeline item type for unified view
export type TimelineItem = {
  id: string;
  type: "image" | "transcription" | "checkpoint";
  timestamp: Date;
  content: Image | Transcription | Checkpoint;
};
