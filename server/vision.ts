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
                text: `You are analyzing a lecture capture image. Do all of the following that apply:

1. EXTRACT TEXT: Copy all visible text exactly as it appears, preserving structure and line breaks.
2. DESCRIBE VISUALS: If the image contains diagrams, charts, equations, graphs, or drawings — describe what they show in 1-2 sentences, even if text is also present.
3. KEY CONCEPTS: If 1-3 clear concepts, terms, or facts are shown, list them at the end under "Key concepts:".

If the image has no useful content (blank, blurry, solid color), just say so briefly.
Keep the total response concise and useful for studying.`,
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
