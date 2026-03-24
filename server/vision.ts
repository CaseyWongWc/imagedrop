import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export class VisionService {
  async extractTextFromUrl(imageUrl: string): Promise<string> {
    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: { url: imageUrl },
              },
              {
                type: "text",
                text: "Extract all visible text from this image. Return only the text content as it appears, preserving line breaks and structure. If there is no text in the image, briefly describe what the image shows instead.",
              },
            ],
          },
        ],
        max_tokens: 2048,
      });

      return response.choices[0]?.message?.content?.trim() ?? "";
    } catch (error) {
      console.error("Vision OCR error:", error);
      throw new Error("Failed to extract text from image");
    }
  }
}
