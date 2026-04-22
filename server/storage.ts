import { eq, desc, asc, and } from "drizzle-orm";
import { db } from "./db";
import { randomUUID } from "crypto";
import {
  notebooks,
  images,
  transcriptions,
  checkpoints,
  notionBlockMappings,
  detailedSummaries,
  detailedSummaryBlockMappings,
  studyGuides,
  studyGuideBlockMappings,
  type Notebook,
  type InsertNotebook,
  type Image,
  type InsertImage,
  type Transcription,
  type InsertTranscription,
  type Checkpoint,
  type InsertCheckpoint,
  type DetailedSummary,
  type InsertDetailedSummary,
  type StudyGuide,
  type StudyGuideBlockMapping,
} from "@shared/schema";

export interface IStorage {
  // Notebook operations
  createNotebook(notebook: InsertNotebook): Promise<Notebook>;
  getNotebook(id: string): Promise<Notebook | undefined>;
  getAllNotebooks(): Promise<Notebook[]>;
  updateNotebook(id: string, data: { title?: string; className?: string | null; notionSyncEnabled?: boolean; sessionEnded?: boolean; autoDetailedSummaryOnEnd?: boolean; autoStudyGuideOnEnd?: boolean }): Promise<Notebook | undefined>;
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
  updateTranscription(id: string, text: string): Promise<Transcription | undefined>;
  deleteTranscription(id: string): Promise<void>;
  deleteAllTranscriptions(): Promise<void>;

  // Checkpoint operations
  createCheckpoint(checkpoint: InsertCheckpoint): Promise<Checkpoint>;
  getCheckpoint(id: string): Promise<Checkpoint | undefined>;
  getCheckpointsByNotebook(notebookId: string): Promise<Checkpoint[]>;
  updateCheckpoint(id: string, label: string | null): Promise<Checkpoint | undefined>;
  deleteCheckpoint(id: string): Promise<void>;

  // Notion block mapping operations (for live edit/delete sync)
  recordNotionBlocks(notebookId: string, localId: string, kind: string, blockIds: string[]): Promise<void>;
  getNotionBlockIds(notebookId: string, localId: string, kind: string): Promise<string[]>;
  deleteNotionBlockMapping(notebookId: string, localId: string, kind: string): Promise<void>;
  clearAllNotionBlockMappings(notebookId: string): Promise<void>;
  getSyncedLocalIds(notebookId: string, kind: string): Promise<Set<string>>;

  // Detailed summary (Phase-2) operations
  createDetailedSummary(summary: InsertDetailedSummary): Promise<DetailedSummary>;
  getDetailedSummary(id: string): Promise<DetailedSummary | undefined>;
  getDetailedSummariesByNotebook(notebookId: string): Promise<DetailedSummary[]>;
  setDetailedSummarySubpage(id: string, subpageId: string | null, subpageUrl: string | null): Promise<DetailedSummary | undefined>;
  recordDetailedSummaryBlocks(detailedSummaryId: string, blockIds: string[]): Promise<void>;
  clearDetailedSummaryBlocks(detailedSummaryId: string): Promise<void>;

  // Study guide (Phase-2) operations
  createStudyGuide(data: {
    id: string;
    notebookId: string;
    sections: string;
    sectionVersions: string;
    model: string;
    tokenCount: number;
  }): Promise<StudyGuide>;
  getStudyGuide(id: string): Promise<StudyGuide | undefined>;
  getStudyGuidesByNotebook(notebookId: string): Promise<StudyGuide[]>;
  updateStudyGuideSection(
    id: string,
    section: string,
    nextSectionsJson: string,
    nextSectionVersionsJson: string,
    tokenCount: number
  ): Promise<StudyGuide | undefined>;
  setStudyGuideSubpage(
    id: string,
    subpageId: string | null,
    subpageUrl: string | null,
    topAnchorBlockId?: string | null
  ): Promise<StudyGuide | undefined>;
  setStudyGuideReviewedItems(id: string, items: string[]): Promise<StudyGuide | undefined>;
  recordStudyGuideSectionBlocks(
    studyGuideId: string,
    sectionName: string,
    blockIds: string[]
  ): Promise<void>;
  getStudyGuideSectionBlocks(
    studyGuideId: string,
    sectionName: string
  ): Promise<string[]>;
  getAllStudyGuideBlockMappings(studyGuideId: string): Promise<StudyGuideBlockMapping[]>;
  clearStudyGuideBlockMappings(studyGuideId: string): Promise<void>;
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

  async updateNotebook(id: string, data: { title?: string; className?: string | null; notionSyncEnabled?: boolean; sessionEnded?: boolean; autoDetailedSummaryOnEnd?: boolean; autoStudyGuideOnEnd?: boolean }): Promise<Notebook | undefined> {
    const updateData: Record<string, any> = {};
    if (data.title !== undefined) updateData.title = data.title;
    if (data.className !== undefined) updateData.className = data.className;
    if (data.notionSyncEnabled !== undefined) updateData.notionSyncEnabled = data.notionSyncEnabled;
    if (data.sessionEnded !== undefined) updateData.sessionEnded = data.sessionEnded;
    if (data.autoDetailedSummaryOnEnd !== undefined) updateData.autoDetailedSummaryOnEnd = data.autoDetailedSummaryOnEnd;
    if (data.autoStudyGuideOnEnd !== undefined) updateData.autoStudyGuideOnEnd = data.autoStudyGuideOnEnd;
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

  async updateTranscription(id: string, text: string): Promise<Transcription | undefined> {
    const [updated] = await db
      .update(transcriptions)
      .set({ text })
      .where(eq(transcriptions.id, id))
      .returning();
    return updated;
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

  async updateCheckpoint(id: string, label: string | null): Promise<Checkpoint | undefined> {
    const [updated] = await db
      .update(checkpoints)
      .set({ label })
      .where(eq(checkpoints.id, id))
      .returning();
    return updated;
  }

  async deleteCheckpoint(id: string): Promise<void> {
    await db.delete(checkpoints).where(eq(checkpoints.id, id));
  }

  // Notion block mapping operations
  async recordNotionBlocks(
    notebookId: string,
    localId: string,
    kind: string,
    blockIds: string[]
  ): Promise<void> {
    if (blockIds.length === 0) return;
    // Replace any existing mapping for the same (notebookId, localId, kind).
    await db
      .delete(notionBlockMappings)
      .where(
        and(
          eq(notionBlockMappings.notebookId, notebookId),
          eq(notionBlockMappings.localId, localId),
          eq(notionBlockMappings.kind, kind)
        )
      );
    await db.insert(notionBlockMappings).values({
      id: randomUUID(),
      notebookId,
      localId,
      kind,
      blockIds,
    });
  }

  async getNotionBlockIds(
    notebookId: string,
    localId: string,
    kind: string
  ): Promise<string[]> {
    const [row] = await db
      .select()
      .from(notionBlockMappings)
      .where(
        and(
          eq(notionBlockMappings.notebookId, notebookId),
          eq(notionBlockMappings.localId, localId),
          eq(notionBlockMappings.kind, kind)
        )
      );
    return row?.blockIds ?? [];
  }

  async getSyncedLocalIds(notebookId: string, kind: string): Promise<Set<string>> {
    const rows = await db
      .select({ localId: notionBlockMappings.localId })
      .from(notionBlockMappings)
      .where(
        and(
          eq(notionBlockMappings.notebookId, notebookId),
          eq(notionBlockMappings.kind, kind)
        )
      );
    return new Set(rows.map((r) => r.localId));
  }

  async deleteNotionBlockMapping(
    notebookId: string,
    localId: string,
    kind: string
  ): Promise<void> {
    await db
      .delete(notionBlockMappings)
      .where(
        and(
          eq(notionBlockMappings.notebookId, notebookId),
          eq(notionBlockMappings.localId, localId),
          eq(notionBlockMappings.kind, kind)
        )
      );
  }

  async clearAllNotionBlockMappings(notebookId: string): Promise<void> {
    await db
      .delete(notionBlockMappings)
      .where(eq(notionBlockMappings.notebookId, notebookId));
  }

  // ============ Detailed summary (Phase-2) operations ============
  async createDetailedSummary(insertSummary: InsertDetailedSummary): Promise<DetailedSummary> {
    const [row] = await db.insert(detailedSummaries).values(insertSummary).returning();
    return row;
  }

  async getDetailedSummary(id: string): Promise<DetailedSummary | undefined> {
    const [row] = await db.select().from(detailedSummaries).where(eq(detailedSummaries.id, id));
    return row;
  }

  async getDetailedSummariesByNotebook(notebookId: string): Promise<DetailedSummary[]> {
    return db
      .select()
      .from(detailedSummaries)
      .where(eq(detailedSummaries.notebookId, notebookId))
      .orderBy(desc(detailedSummaries.createdAt));
  }

  async setDetailedSummarySubpage(
    id: string,
    subpageId: string | null,
    subpageUrl: string | null
  ): Promise<DetailedSummary | undefined> {
    const [updated] = await db
      .update(detailedSummaries)
      .set({ notionSubpageId: subpageId, notionSubpageUrl: subpageUrl })
      .where(eq(detailedSummaries.id, id))
      .returning();
    return updated;
  }

  async recordDetailedSummaryBlocks(detailedSummaryId: string, blockIds: string[]): Promise<void> {
    if (blockIds.length === 0) return;
    await db
      .delete(detailedSummaryBlockMappings)
      .where(eq(detailedSummaryBlockMappings.detailedSummaryId, detailedSummaryId));
    await db.insert(detailedSummaryBlockMappings).values({
      id: randomUUID(),
      detailedSummaryId,
      blockIds,
    });
  }

  async clearDetailedSummaryBlocks(detailedSummaryId: string): Promise<void> {
    await db
      .delete(detailedSummaryBlockMappings)
      .where(eq(detailedSummaryBlockMappings.detailedSummaryId, detailedSummaryId));
  }

  // ============ Study guide (Phase-2) operations ============
  async createStudyGuide(data: {
    id: string;
    notebookId: string;
    sections: string;
    sectionVersions: string;
    model: string;
    tokenCount: number;
  }): Promise<StudyGuide> {
    const [row] = await db.insert(studyGuides).values(data).returning();
    return row;
  }

  async getStudyGuide(id: string): Promise<StudyGuide | undefined> {
    const [row] = await db.select().from(studyGuides).where(eq(studyGuides.id, id));
    return row;
  }

  async getStudyGuidesByNotebook(notebookId: string): Promise<StudyGuide[]> {
    return db
      .select()
      .from(studyGuides)
      .where(eq(studyGuides.notebookId, notebookId))
      .orderBy(desc(studyGuides.createdAt));
  }

  async updateStudyGuideSection(
    id: string,
    _section: string,
    nextSectionsJson: string,
    nextSectionVersionsJson: string,
    tokenCount: number
  ): Promise<StudyGuide | undefined> {
    const [updated] = await db
      .update(studyGuides)
      .set({
        sections: nextSectionsJson,
        sectionVersions: nextSectionVersionsJson,
        tokenCount,
      })
      .where(eq(studyGuides.id, id))
      .returning();
    return updated;
  }

  async setStudyGuideSubpage(
    id: string,
    subpageId: string | null,
    subpageUrl: string | null,
    topAnchorBlockId?: string | null
  ): Promise<StudyGuide | undefined> {
    const patch: Partial<StudyGuide> = {
      notionSubpageId: subpageId,
      notionSubpageUrl: subpageUrl,
    };
    if (topAnchorBlockId !== undefined) {
      patch.topAnchorBlockId = topAnchorBlockId;
    } else if (subpageId === null) {
      // If we're clearing the subpage, also clear the anchor — it's only
      // meaningful in the context of an existing subpage.
      patch.topAnchorBlockId = null;
    }
    const [updated] = await db
      .update(studyGuides)
      .set(patch)
      .where(eq(studyGuides.id, id))
      .returning();
    return updated;
  }

  async setStudyGuideReviewedItems(
    id: string,
    items: string[]
  ): Promise<StudyGuide | undefined> {
    const [updated] = await db
      .update(studyGuides)
      .set({ reviewedItems: items })
      .where(eq(studyGuides.id, id))
      .returning();
    return updated;
  }

  async recordStudyGuideSectionBlocks(
    studyGuideId: string,
    sectionName: string,
    blockIds: string[]
  ): Promise<void> {
    await db
      .delete(studyGuideBlockMappings)
      .where(
        and(
          eq(studyGuideBlockMappings.studyGuideId, studyGuideId),
          eq(studyGuideBlockMappings.sectionName, sectionName)
        )
      );
    if (blockIds.length === 0) return;
    await db.insert(studyGuideBlockMappings).values({
      id: randomUUID(),
      studyGuideId,
      sectionName,
      blockIds,
    });
  }

  async getStudyGuideSectionBlocks(
    studyGuideId: string,
    sectionName: string
  ): Promise<string[]> {
    const [row] = await db
      .select()
      .from(studyGuideBlockMappings)
      .where(
        and(
          eq(studyGuideBlockMappings.studyGuideId, studyGuideId),
          eq(studyGuideBlockMappings.sectionName, sectionName)
        )
      );
    return row?.blockIds ?? [];
  }

  async getAllStudyGuideBlockMappings(
    studyGuideId: string
  ): Promise<StudyGuideBlockMapping[]> {
    return db
      .select()
      .from(studyGuideBlockMappings)
      .where(eq(studyGuideBlockMappings.studyGuideId, studyGuideId));
  }

  async clearStudyGuideBlockMappings(studyGuideId: string): Promise<void> {
    await db
      .delete(studyGuideBlockMappings)
      .where(eq(studyGuideBlockMappings.studyGuideId, studyGuideId));
  }
}

export const storage = new DbStorage();
