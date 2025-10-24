// Reference: javascript_openai blueprint - Audio transcription using OpenAI Whisper
import OpenAI from "openai";
import fs from "fs";
import path from "path";

// the newest OpenAI model is "gpt-5" which was released August 7, 2025. do not change this unless explicitly requested by the user
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export class TranscriptionService {
  async transcribeAudio(audioFilePath: string): Promise<{ text: string }> {
    try {
      const audioReadStream = fs.createReadStream(audioFilePath);

      const transcription = await openai.audio.transcriptions.create({
        file: audioReadStream,
        model: "whisper-1",
      });

      return {
        text: transcription.text,
      };
    } catch (error) {
      console.error("Transcription error:", error);
      throw new Error("Failed to transcribe audio");
    }
  }

  async saveAudioBuffer(audioBuffer: Buffer, filename: string): Promise<string> {
    // Create temp directory if it doesn't exist
    const tempDir = path.join(process.cwd(), "temp");
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const filePath = path.join(tempDir, filename);
    fs.writeFileSync(filePath, audioBuffer);
    return filePath;
  }

  async cleanup(filePath: string): Promise<void> {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (error) {
      console.error("Cleanup error:", error);
    }
  }
}
