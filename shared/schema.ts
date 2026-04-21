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
});

export const insertNotebookSchema = createInsertSchema(notebooks).omit({
  createdAt: true,
  notionPageId: true,
  notionSyncError: true,
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

// Timeline item type for unified view
export type TimelineItem = {
  id: string;
  type: "image" | "transcription" | "checkpoint";
  timestamp: Date;
  content: Image | Transcription | Checkpoint;
};
