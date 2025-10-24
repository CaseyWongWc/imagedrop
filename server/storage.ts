import { type Image, type InsertImage } from "@shared/schema";

export interface IStorage {
  // Image operations
  createImage(image: InsertImage): Promise<Image>;
  getImage(id: string): Promise<Image | undefined>;
  getAllImages(): Promise<Image[]>;
  deleteImage(id: string): Promise<void>;
  deleteAllImages(): Promise<void>;
}

export class MemStorage implements IStorage {
  private images: Map<string, Image>;

  constructor() {
    this.images = new Map();
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
}

export const storage = new MemStorage();
