import { type Image, type InsertImage, type Transcription, type InsertTranscription } from "@shared/schema";

export interface IStorage {
  // Image operations
  createImage(image: InsertImage): Promise<Image>;
  getImage(id: string): Promise<Image | undefined>;
  getAllImages(): Promise<Image[]>;
  deleteImage(id: string): Promise<void>;
  deleteAllImages(): Promise<void>;
  
  // Transcription operations
  createTranscription(transcription: InsertTranscription): Promise<Transcription>;
  getTranscription(id: string): Promise<Transcription | undefined>;
  getAllTranscriptions(): Promise<Transcription[]>;
  deleteTranscription(id: string): Promise<void>;
  deleteAllTranscriptions(): Promise<void>;
}

export class MemStorage implements IStorage {
  private images: Map<string, Image>;
  private transcriptions: Map<string, Transcription>;

  constructor() {
    this.images = new Map();
    this.transcriptions = new Map();
  }

  async createImage(insertImage: InsertImage): Promise<Image> {
    const image: Image = {
      ...insertImage,
      uploadedAt: new Date(),
    };
    this.images.set(image.id, image);
    return image;
  }

  async getImage(id: string): Promise<Image | undefined> {
    return this.images.get(id);
  }

  async getAllImages(): Promise<Image[]> {
    return Array.from(this.images.values()).sort(
      (a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime()
    );
  }

  async deleteImage(id: string): Promise<void> {
    this.images.delete(id);
  }

  async deleteAllImages(): Promise<void> {
    this.images.clear();
  }

  async createTranscription(insertTranscription: InsertTranscription): Promise<Transcription> {
    const transcription: Transcription = {
      ...insertTranscription,
      createdAt: new Date(),
    };
    this.transcriptions.set(transcription.id, transcription);
    return transcription;
  }

  async getTranscription(id: string): Promise<Transcription | undefined> {
    return this.transcriptions.get(id);
  }

  async getAllTranscriptions(): Promise<Transcription[]> {
    return Array.from(this.transcriptions.values()).sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
    );
  }

  async deleteTranscription(id: string): Promise<void> {
    this.transcriptions.delete(id);
  }

  async deleteAllTranscriptions(): Promise<void> {
    this.transcriptions.clear();
  }
}

export const storage = new MemStorage();
