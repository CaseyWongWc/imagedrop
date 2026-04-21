import { eq, desc, asc } from "drizzle-orm";
import { db } from "./db";
import {
  notebooks,
  images,
  transcriptions,
  checkpoints,
  type Notebook,
  type InsertNotebook,
  type Image,
  type InsertImage,
  type Transcription,
  type InsertTranscription,
  type Checkpoint,
  type InsertCheckpoint,
} from "@shared/schema";

export interface IStorage {
  // Notebook operations
  createNotebook(notebook: InsertNotebook): Promise<Notebook>;
  getNotebook(id: string): Promise<Notebook | undefined>;
  getAllNotebooks(): Promise<Notebook[]>;
  updateNotebook(id: string, data: { title?: string; className?: string | null; notionSyncEnabled?: boolean }): Promise<Notebook | undefined>;
  setNotebookNotionPage(id: string, notionPageId: string | null): Promise<Notebook | undefined>;
  setNotebookSyncError(id: string, error: string | null): Promise<Notebook | undefined>;
  deleteNotebook(id: string): Promise<void>;

  // Image operations
  createImage(image: InsertImage): Promise<Image>;
  getImage(id: string): Promise<Image | undefined>;
  getAllImages(): Promise<Image[]>;
  getImagesByNotebook(notebookId: string): Promise<Image[]>;
  updateImageOcr(id: string, ocrText: string): Promise<Image | undefined>;
  deleteImage(id: string): Promise<void>;
  deleteAllImages(): Promise<void>;

  // Transcription operations
  createTranscription(transcription: InsertTranscription): Promise<Transcription>;
  getTranscription(id: string): Promise<Transcription | undefined>;
  getAllTranscriptions(): Promise<Transcription[]>;
  getTranscriptionsByNotebook(notebookId: string): Promise<Transcription[]>;
  deleteTranscription(id: string): Promise<void>;
  deleteAllTranscriptions(): Promise<void>;

  // Checkpoint operations
  createCheckpoint(checkpoint: InsertCheckpoint): Promise<Checkpoint>;
  getCheckpoint(id: string): Promise<Checkpoint | undefined>;
  getCheckpointsByNotebook(notebookId: string): Promise<Checkpoint[]>;
  deleteCheckpoint(id: string): Promise<void>;
}

export class DbStorage implements IStorage {
  // Notebook operations
  async createNotebook(insertNotebook: InsertNotebook): Promise<Notebook> {
    const [notebook] = await db.insert(notebooks).values(insertNotebook).returning();
    return notebook;
  }

  async getNotebook(id: string): Promise<Notebook | undefined> {
    const [notebook] = await db.select().from(notebooks).where(eq(notebooks.id, id));
    return notebook;
  }

  async getAllNotebooks(): Promise<Notebook[]> {
    return db.select().from(notebooks).orderBy(desc(notebooks.createdAt));
  }

  async updateNotebook(id: string, data: { title?: string; className?: string | null; notionSyncEnabled?: boolean }): Promise<Notebook | undefined> {
    const updateData: Record<string, any> = {};
    if (data.title !== undefined) updateData.title = data.title;
    if (data.className !== undefined) updateData.className = data.className;
    if (data.notionSyncEnabled !== undefined) updateData.notionSyncEnabled = data.notionSyncEnabled;
    if (Object.keys(updateData).length === 0) {
      return this.getNotebook(id);
    }
    const [updated] = await db.update(notebooks).set(updateData).where(eq(notebooks.id, id)).returning();
    return updated;
  }

  async setNotebookNotionPage(id: string, notionPageId: string | null): Promise<Notebook | undefined> {
    const [updated] = await db
      .update(notebooks)
      .set({ notionPageId })
      .where(eq(notebooks.id, id))
      .returning();
    return updated;
  }

  async setNotebookSyncError(id: string, error: string | null): Promise<Notebook | undefined> {
    const [updated] = await db
      .update(notebooks)
      .set({ notionSyncError: error })
      .where(eq(notebooks.id, id))
      .returning();
    return updated;
  }

  async deleteNotebook(id: string): Promise<void> {
    await db.delete(notebooks).where(eq(notebooks.id, id));
  }

  // Image operations
  async createImage(insertImage: InsertImage): Promise<Image> {
    const [image] = await db.insert(images).values(insertImage).returning();
    return image;
  }

  async getImage(id: string): Promise<Image | undefined> {
    const [image] = await db.select().from(images).where(eq(images.id, id));
    return image;
  }

  async getAllImages(): Promise<Image[]> {
    return db.select().from(images).orderBy(desc(images.uploadedAt));
  }

  async getImagesByNotebook(notebookId: string): Promise<Image[]> {
    return db
      .select()
      .from(images)
      .where(eq(images.notebookId, notebookId))
      .orderBy(asc(images.uploadedAt));
  }

  async updateImageOcr(id: string, ocrText: string): Promise<Image | undefined> {
    const [updated] = await db
      .update(images)
      .set({ ocrText })
      .where(eq(images.id, id))
      .returning();
    return updated;
  }

  async deleteImage(id: string): Promise<void> {
    await db.delete(images).where(eq(images.id, id));
  }

  async deleteAllImages(): Promise<void> {
    await db.delete(images);
  }

  // Transcription operations
  async createTranscription(insertTranscription: InsertTranscription): Promise<Transcription> {
    const [transcription] = await db.insert(transcriptions).values(insertTranscription).returning();
    return transcription;
  }

  async getTranscription(id: string): Promise<Transcription | undefined> {
    const [transcription] = await db.select().from(transcriptions).where(eq(transcriptions.id, id));
    return transcription;
  }

  async getAllTranscriptions(): Promise<Transcription[]> {
    return db.select().from(transcriptions).orderBy(asc(transcriptions.createdAt));
  }

  async getTranscriptionsByNotebook(notebookId: string): Promise<Transcription[]> {
    return db
      .select()
      .from(transcriptions)
      .where(eq(transcriptions.notebookId, notebookId))
      .orderBy(asc(transcriptions.createdAt));
  }

  async deleteTranscription(id: string): Promise<void> {
    await db.delete(transcriptions).where(eq(transcriptions.id, id));
  }

  async deleteAllTranscriptions(): Promise<void> {
    await db.delete(transcriptions);
  }

  // Checkpoint operations
  async createCheckpoint(insertCheckpoint: InsertCheckpoint): Promise<Checkpoint> {
    const [checkpoint] = await db.insert(checkpoints).values(insertCheckpoint).returning();
    return checkpoint;
  }

  async getCheckpoint(id: string): Promise<Checkpoint | undefined> {
    const [checkpoint] = await db.select().from(checkpoints).where(eq(checkpoints.id, id));
    return checkpoint;
  }

  async getCheckpointsByNotebook(notebookId: string): Promise<Checkpoint[]> {
    return db
      .select()
      .from(checkpoints)
      .where(eq(checkpoints.notebookId, notebookId))
      .orderBy(asc(checkpoints.createdAt));
  }

  async deleteCheckpoint(id: string): Promise<void> {
    await db.delete(checkpoints).where(eq(checkpoints.id, id));
  }
}

export const storage = new DbStorage();
