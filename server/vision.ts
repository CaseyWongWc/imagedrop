import OpenAI from "openai";
import { ObjectStorageService } from "./replit_integrations/object_storage";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export class VisionService {
  private objectStorageService: ObjectStorageService;

  constructor() {
    this.objectStorageService = new ObjectStorageService();
  }

  async analyzeImage(objectPath: string): Promise<string> {
    try {
      const objectFile = await this.objectStorageService.getObjectEntityFile(objectPath);
      const chunks: Buffer[] = [];
      await new Promise<void>((resolve, reject) => {
        const stream = objectFile.createReadStream();
        stream.on("data", (chunk: Buffer) => chunks.push(chunk));
        stream.on("end", resolve);
        stream.on("error", reject);
      });
      const imageBuffer = Buffer.concat(chunks);
      const base64Image = imageBuffer.toString("base64");

      const ext = objectPath.split(".").pop()?.toLowerCase();
      let mimeType = "image/jpeg";
      if (ext === "png") mimeType = "image/png";
      else if (ext === "gif") mimeType = "image/gif";
      else if (ext === "webp") mimeType = "image/webp";

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: {
                  url: `data:${mimeType};base64,${base64Image}`,
                  detail: "high",
                },
              },
              {
                type: "text",
                text: "Extract ALL text visible in this image exactly as it appears (OCR). If there is no text, briefly describe what you see in 1-2 sentences. Format any extracted text clearly.",
              },
            ],
          },
        ],
        max_tokens: 1000,
      });

      return response.choices[0]?.message?.content?.trim() || "";
    } catch (error) {
      console.error("Vision OCR error:", error);
      throw error;
    }
  }
}
