import OpenAI from "openai";
// Dynamic import for pdf-parse to avoid file loading issues at startup
import axios from "axios";
import * as cheerio from "cheerio";
import { generatedQuizSchema, extractedQuizSchema, type GeneratedQuiz, type ExtractedQuiz } from "@shared/schema";

// the newest OpenAI model is "gpt-4o" which was released May 13, 2024. do not change this unless explicitly requested by the user
//
// Lazy client: instantiate on first use rather than at module load. Without this,
// importing this module crashes the server boot when OPENAI_API_KEY is unset
// (which is fine for any deploy that doesn't use the AI routes — and it's the
// default in CI). Routes already short-circuit with a 500 if the key is missing,
// so this lazy throw is the safety net, not the primary check.
let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (_openai) return _openai;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set; OpenAI-backed routes are unavailable.");
  }
  _openai = new OpenAI({ apiKey, timeout: 30000 });
  return _openai;
}

// A compact JSON example the model must match. Kept in one place so the prompt
// and the validator never drift.
const CANONICAL_EXAMPLE = `{
  "title": "Quiz title",
  "description": "One-sentence description",
  "subject": "Subject area (optional)",
  "tags": ["2-4", "topic", "tags"],
  "questions": [
    {
      "question": "A single-select question?",
      "type": "quiz",
      "answerType": "single",
      "answers": ["A", "B", "C", "D"],
      "correctAnswers": [0],
      "timeLimit": 20,
      "points": "standard",
      "difficulty": "easy",
      "explanation": "Why A is correct, in 1-2 sentences."
    },
    {
      "question": "A true/false question?",
      "type": "true_false",
      "answerType": "single",
      "answers": ["True", "False"],
      "correctAnswers": [0],
      "timeLimit": 15,
      "points": "standard",
      "difficulty": "medium",
      "explanation": "Why it is true."
    }
  ]
}`;

export function buildGenerationPrompt(kind: "topics" | "content", input: string, sourceTitle?: string): string {
  const head =
    kind === "topics"
      ? `Create a comprehensive educational quiz based on these topics: "${input.trim()}"`
      : `Based on the following content, create a comprehensive educational quiz.\n\nContent Title: ${sourceTitle ?? "Content"}\nContent: ${input}`;
  return `${head}

Requirements:
1. Generate 8-12 questions.
2. MOST questions are single-select (type "quiz", answerType "single", 4 answers, exactly one index in correctAnswers).
3. Include 1-3 true/false questions (type "true_false", answers exactly ["True","False"]).
4. Include 0-2 multi-select questions (answerType "multiple", 2+ indexes in correctAnswers).
5. NEVER produce poll questions.
6. Each question needs a timeLimit (10-30), a "difficulty" of "easy"|"medium"|"hard", and a 1-2 sentence "explanation" of the correct answer.
7. Add a quiz-level "subject" and 2-4 "tags".
8. Answers are unambiguous and accurate; correctAnswers indexes are 0-based and in range.

Respond with ONLY valid JSON in exactly this shape:
${CANONICAL_EXAMPLE}`;
}

export function parseGeneratedQuiz(raw: unknown):
  | { ok: true; data: GeneratedQuiz }
  | { ok: false; errors: string } {
  const result = generatedQuizSchema.safeParse(raw);
  if (result.success) return { ok: true, data: result.data };
  const errors = result.error.errors
    .map((e) => `${e.path.join(".") || "(root)"}: ${e.message}`)
    .join("; ");
  return { ok: false, errors };
}

export function parseExtractedQuiz(raw: unknown):
  | { ok: true; data: ExtractedQuiz }
  | { ok: false; errors: string } {
  const result = extractedQuizSchema.safeParse(raw);
  if (result.success) return { ok: true, data: result.data };
  const errors = result.error.errors
    .map((e) => `${e.path.join(".") || "(root)"}: ${e.message}`)
    .join("; ");
  return { ok: false, errors };
}

export function buildExtractionPrompt(documentText: string): string {
  return `Extract the quiz questions that appear in the following document.

STRICT RULES:
1. Extract ONLY questions that actually exist in the document. NEVER invent new questions.
2. Keep the document's original language (Arabic stays Arabic, English stays English) for questions, answers, and explanations.
3. If the document marks the correct answer (answer key, bold, asterisk, "Answer: B", etc.), use it.
4. If the correct answer is not marked but is unambiguous from the document content, infer it.
5. If a question's correct answer cannot be determined, SKIP that question entirely.
6. NEVER produce poll questions; every question needs at least one correct answer.
7. Set "difficulty" and "explanation" only when the document itself supports them; otherwise omit those fields.
8. Set a quiz-level "subject" and up to 8 "tags" from the document's topic.
9. Each question has 2-6 answers; correctAnswers are 0-based indexes; questions with several correct answers use answerType "multiple".
10. Title the quiz from the document's title or main topic.

Document:
${documentText}

Respond with ONLY valid JSON in exactly this shape:
${CANONICAL_EXAMPLE}`;
}

// Shared core: prompt → OpenAI → validate → one error-fed retry. Used by both
// quiz GENERATION (create questions about a topic) and quiz EXTRACTION (pull
// existing questions out of an uploaded document).
async function completeValidated<T>(
  basePrompt: string,
  parse: (raw: unknown) => { ok: true; data: T } | { ok: false; errors: string },
  opts: { temperature: number; maxTokens: number },
): Promise<T> {
  let lastErrors = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const prompt = attempt === 0
      ? basePrompt
      : `${basePrompt}\n\nYour previous response failed validation: ${lastErrors}\nReturn corrected JSON only.`;
    const response = await getOpenAI().chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "You are an expert educator and quiz creator. Always respond with valid JSON matching the exact schema requested." },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      temperature: opts.temperature,
      max_tokens: opts.maxTokens,
    });
    const content = response.choices[0].message.content;
    if (!content) { lastErrors = "empty response"; continue; }
    let raw: unknown;
    try { raw = JSON.parse(content); } catch { lastErrors = "response was not valid JSON"; continue; }
    const parsed = parse(raw);
    if (parsed.ok) return parsed.data;
    lastErrors = parsed.errors;
  }
  throw new Error("Failed to generate a properly formatted quiz. Please try again.");
}

async function generateValidated(kind: "topics" | "content", input: string, sourceTitle?: string): Promise<GeneratedQuiz> {
  return completeValidated(buildGenerationPrompt(kind, input, sourceTitle), parseGeneratedQuiz, {
    temperature: 0.7,
    maxTokens: 3500,
  });
}

// Low temperature: extraction is transcription, not creativity. High token
// cap: a document can hold up to 100 questions (extractedQuizSchema's max).
export async function extractQuizFromText(documentText: string): Promise<ExtractedQuiz> {
  try {
    return await completeValidated(buildExtractionPrompt(documentText), parseExtractedQuiz, {
      temperature: 0.2,
      maxTokens: 16000,
    });
  } catch (error: any) {
    console.error("Quiz extraction error:", error);
    throw mapOpenAiError(error, `Failed to extract questions from the document: ${error.message}`);
  }
}

function mapOpenAiError(error: any, fallbackMessage: string): Error {
  if (error?.status === 401) return new Error("OpenAI API authentication failed. Please check API key configuration.");
  if (error?.status === 429) return new Error("OpenAI API rate limit exceeded. Please try again in a few minutes.");
  if (error?.status === 500) return new Error("OpenAI API service is temporarily unavailable. Please try again later.");
  if (error?.code === "insufficient_quota") return new Error("OpenAI API quota exceeded. Please check your account usage.");
  // Preserve already-user-facing messages thrown by our own guards/validator.
  if (typeof error?.message === "string" && /too short|Failed to generate a properly formatted quiz/.test(error.message)) return error;
  return new Error(fallbackMessage);
}

export async function generateQuizFromPDF(pdfBuffer: Buffer): Promise<GeneratedQuiz> {
  try {
    // Dynamic import (not a static import) to avoid file loading issues.
    const pdfParse = (await import("pdf-parse")).default;

    // Extract text from PDF
    const pdfData = await pdfParse(pdfBuffer);
    const content = pdfData.text;

    if (!content || content.trim().length < 100) {
      throw new Error("PDF content is too short or empty to generate a meaningful quiz");
    }

    return await generateQuizFromContent(content, "PDF Document");
  } catch (error: any) {
    console.error("PDF processing error:", error);
    throw mapOpenAiError(error, `Failed to process PDF: ${error.message}`);
  }
}

export async function generateQuizFromURL(url: string): Promise<GeneratedQuiz> {
  try {
    // Fetch the webpage content
    const response = await axios.get(url, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });

    // Parse HTML and extract text content
    const $ = cheerio.load(response.data);
    
    // Remove script and style elements
    $('script, style, nav, footer, aside, .navigation, .sidebar, .menu, .ads').remove();
    
    // Get main content (try common selectors for article content)
    let content = '';
    const mainSelectors = ['article', 'main', '.content', '.post', '.article', '.entry'];
    
    for (const selector of mainSelectors) {
      const element = $(selector);
      if (element.length && element.text().trim().length > content.length) {
        content = element.text().trim();
      }
    }
    
    // Fallback to body if no main content found
    if (!content || content.length < 200) {
      content = $('body').text().trim();
    }

    // Clean up whitespace
    content = content.replace(/\s+/g, ' ').trim();

    if (!content || content.length < 100) {
      throw new Error("URL content is too short or empty to generate a meaningful quiz");
    }

    // Extract title from the page
    const pageTitle = $('title').text().trim() || $('h1').first().text().trim() || "Web Article";

    return await generateQuizFromContent(content, pageTitle);
  } catch (error: any) {
    if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      throw new Error("Unable to access the URL. Please check if the URL is correct and accessible.");
    }
    throw mapOpenAiError(error, `Failed to process URL: ${error.message}`);
  }
}

export async function generateQuizFromTopics(topics: string): Promise<GeneratedQuiz> {
  try {
    if (!topics || topics.trim().length < 3) {
      throw new Error("Topics input is too short. Please provide specific topics or subjects.");
    }
    return await generateValidated("topics", topics.trim());
  } catch (error: any) {
    console.error("Topics quiz generation error:", error);
    throw mapOpenAiError(error, `Failed to generate quiz from topics: ${error.message}`);
  }
}

async function generateQuizFromContent(content: string, sourceTitle: string): Promise<GeneratedQuiz> {
  const maxContentLength = 8000;
  const truncated = content.length > maxContentLength ? content.substring(0, maxContentLength) + "..." : content;
  return await generateValidated("content", truncated, sourceTitle);
}

export async function generateQuizFromText(text: string): Promise<GeneratedQuiz> {
  try {
    if (!text || text.trim().length < 50) {
      throw new Error("Text content is too short to generate a meaningful quiz");
    }

    return await generateQuizFromContent(text, "Text Content");
  } catch (error: any) {
    console.error("Text quiz generation error:", error);
    throw mapOpenAiError(error, `Failed to generate quiz from text: ${error.message}`);
  }
}

export async function generateBackgroundImage(title: string, description: string): Promise<string> {
  try {
    if (!title || title.trim().length < 3) {
      throw new Error("Quiz title is required to generate a background");
    }

    // Limit description length to prevent prompt injection
    const maxDescLength = 200;
    const safeDescription = description && description.trim().length > 0 
      ? description.trim().substring(0, maxDescLength) 
      : '';

    // Create a descriptive prompt for DALL-E
    const prompt = `Educational quiz background image for a quiz titled "${title.trim()}"${safeDescription ? `, about: ${safeDescription}` : ''}. Create a vibrant, colorful classroom or learning environment background that is visually appealing and suitable for an educational quiz game. The style should be modern, friendly, and engaging for students. Include educational elements like books, desks, or learning materials. The image should work well as a background with text overlaid on top. No text or words in the image.`;

    console.log("Generating background image with DALL-E");

    const response = await getOpenAI().images.generate({
      model: "dall-e-3",
      prompt: prompt,
      n: 1,
      size: "1024x1024",
      quality: "standard",
      response_format: "b64_json"
    });

    if (!response.data || !response.data[0] || !response.data[0].b64_json) {
      throw new Error("Invalid response from image generation API");
    }

    // Convert base64 to data URL
    const base64Image = response.data[0].b64_json;
    const dataUrl = `data:image/png;base64,${base64Image}`;

    return dataUrl;
  } catch (error: any) {
    console.error("Background image generation error:", error);
    
    // Handle specific OpenAI API errors
    if (error.status === 401) {
      throw new Error("Authentication failed. Please contact support.");
    }
    if (error.status === 429) {
      throw new Error("Service busy. Please try again in a few minutes.");
    }
    if (error.status === 500) {
      throw new Error("Service temporarily unavailable. Please try again later.");
    }
    if (error.code === 'insufficient_quota') {
      throw new Error("Service quota exceeded. Please try again later.");
    }
    if (error.response?.status === 400 && error.response?.data?.error?.message?.includes('content_policy')) {
      throw new Error("Content policy violation. Please try with different quiz details.");
    }
    
    throw new Error("Failed to generate background image. Please try again.");
  }
}
