import { pgTable, text, varchar, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { relations } from "drizzle-orm";

// Notebooks schema - the spine of the app
export const notebooks = pgTable("notebooks", {
  id: varchar("id").primaryKey(),
  title: text("title").notNull(),
  className: text("class_name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertNotebookSchema = createInsertSchema(notebooks).omit({
  createdAt: true,
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

// Timeline item type for unified view
export type TimelineItem = {
  id: string;
  type: "image" | "transcription" | "checkpoint";
  timestamp: Date;
  content: Image | Transcription | Checkpoint;
};
