// Reference: javascript_object_storage blueprint - Routes for public file uploading
import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import {
  ObjectStorageService,
  ObjectNotFoundError,
} from "./objectStorage";
import { insertImageSchema, insertTranscriptionSchema, type Image } from "@shared/schema";
import { TranscriptionService } from "./transcription";
import { randomUUID } from "crypto";

export async function registerRoutes(app: Express): Promise<Server> {
  const objectStorageService = new ObjectStorageService();
  const transcriptionService = new TranscriptionService();

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
      const uploadURL = await objectStorageService.getObjectEntityUploadURL();
      res.json({ uploadURL });
    } catch (error) {
      console.error("Error getting upload URL:", error);
      res.status(500).json({ error: "Failed to get upload URL" });
    }
  });

  // Create image record
  app.post("/api/images", async (req, res) => {
    try {
      const validatedData = insertImageSchema.parse(req.body);
      const image = await storage.createImage(validatedData);
      res.json(image);
    } catch (error) {
      console.error("Error creating image:", error);
      res.status(400).json({ error: "Invalid image data" });
    }
  });

  // Get all images
  app.get("/api/images", async (req, res) => {
    try {
      const images = await storage.getAllImages();
      res.json(images);
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
      // First, get the image metadata to find the object path
      const image = await storage.getImage(req.params.id);
      if (!image) {
        return res.status(404).json({ error: "Image not found" });
      }

      // Delete the actual object from cloud storage first
      const objectFile = await objectStorageService.getObjectEntityFile(image.objectPath);
      await objectFile.delete();

      // Only delete metadata if cloud object deletion succeeded
      await storage.deleteImage(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting image:", error);
      if (error instanceof ObjectNotFoundError) {
        // Object not found - still delete metadata
        await storage.deleteImage(req.params.id);
        return res.json({ success: true });
      }
      res.status(500).json({ error: "Failed to delete image" });
    }
  });

  // Delete all images and transcriptions
  app.delete("/api/images", async (req, res) => {
    try {
      // Get all images first to delete from cloud storage
      const images = await storage.getAllImages();
      
      // Delete all objects from cloud storage
      for (const image of images) {
        try {
          const objectFile = await objectStorageService.getObjectEntityFile(image.objectPath);
          await objectFile.delete();
        } catch (error) {
          if (!(error instanceof ObjectNotFoundError)) {
            console.error(`Error deleting object ${image.objectPath}:`, error);
          }
          // Continue even if individual deletes fail
        }
      }

      // Delete all metadata (images and transcriptions)
      await storage.deleteAllImages();
      await storage.deleteAllTranscriptions();
      res.json({ success: true, deletedCount: images.length });
    } catch (error) {
      console.error("Error deleting all images:", error);
      res.status(500).json({ error: "Failed to delete all images" });
    }
  });

  // Create transcription record
  app.post("/api/transcriptions", async (req, res) => {
    try {
      const validatedData = insertTranscriptionSchema.parse(req.body);
      const transcription = await storage.createTranscription(validatedData);
      res.json(transcription);
    } catch (error) {
      console.error("Error creating transcription:", error);
      res.status(400).json({ error: "Invalid transcription data" });
    }
  });

  // Get all transcriptions
  app.get("/api/transcriptions", async (req, res) => {
    try {
      const transcriptions = await storage.getAllTranscriptions();
      res.json(transcriptions);
    } catch (error) {
      console.error("Error fetching transcriptions:", error);
      res.status(500).json({ error: "Failed to fetch transcriptions" });
    }
  });

  // Delete transcription
  app.delete("/api/transcriptions/:id", async (req, res) => {
    try {
      await storage.deleteTranscription(req.params.id);
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

      // Convert base64 audio to buffer
      const audioBuffer = Buffer.from(req.body.audio, "base64");
      const filename = `audio-${Date.now()}.webm`;
      
      // Save audio temporarily
      tempFilePath = await transcriptionService.saveAudioBuffer(audioBuffer, filename);
      
      // Transcribe audio
      const result = await transcriptionService.transcribeAudio(tempFilePath);
      
      // Create transcription record
      const transcription = await storage.createTranscription({
        id: randomUUID(),
        text: result.text,
      });
      
      res.json(transcription);
    } catch (error) {
      console.error("Error transcribing audio:", error);
      res.status(500).json({ error: "Failed to transcribe audio" });
    } finally {
      // Cleanup temp file
      if (tempFilePath) {
        await transcriptionService.cleanup(tempFilePath);
      }
    }
  });

  const httpServer = createServer(app);

  return httpServer;
}
