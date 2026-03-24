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
  type Image,
  type Transcription,
  type Checkpoint,
  type TimelineItem,
} from "@shared/schema";
import { TranscriptionService } from "./transcription";
import { VisionService } from "./vision";
import { exportNotebookToNotion } from "./notion";
import { randomUUID } from "crypto";

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
      res.json(notebook);
    } catch (error) {
      console.error("Error fetching notebook:", error);
      res.status(500).json({ error: "Failed to fetch notebook" });
    }
  });

  // Update notebook
  app.patch("/api/notebooks/:id", async (req, res) => {
    try {
      const { title, className } = req.body;
      if (!title && className === undefined) {
        return res.status(400).json({ error: "No fields to update" });
      }
      const updated = await storage.updateNotebook(req.params.id, { title, className });
      if (!updated) {
        return res.status(404).json({ error: "Notebook not found" });
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

      // Trigger background OCR (non-blocking)
      const imageUrl = `${req.protocol}://${req.get("host")}${image.objectPath}`;
      visionService.extractTextFromUrl(imageUrl).then(async (ocrText) => {
        await storage.updateImageOcr(image.id, ocrText);
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

  // Delete checkpoint
  app.delete("/api/checkpoints/:id", async (req, res) => {
    try {
      await storage.deleteCheckpoint(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting checkpoint:", error);
      res.status(500).json({ error: "Failed to delete checkpoint" });
    }
  });

  // ============ NOTION EXPORT ROUTE ============

  // Export notebook to Notion
  app.post("/api/notebooks/:id/export/notion", async (req, res) => {
    try {
      const notebookId = req.params.id;

      const notebook = await storage.getNotebook(notebookId);
      if (!notebook) {
        return res.status(404).json({ error: "Notebook not found" });
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

      const result = await exportNotebookToNotion(
        notebook.title,
        notebook.className,
        notebook.createdAt,
        timeline,
        baseUrl
      );

      res.json({ url: result.url, pageId: result.pageId });
    } catch (error: any) {
      console.error("Error exporting to Notion:", error);
      res.status(500).json({ error: error?.message || "Failed to export to Notion" });
    }
  });

  const httpServer = createServer(app);

  return httpServer;
}
