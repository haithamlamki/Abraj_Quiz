import OpenAI from "openai";
// Dynamic import for pdf-parse to avoid file loading issues at startup
import axios from "axios";
import * as cheerio from "cheerio";

// the newest OpenAI model is "gpt-4o" which was released May 13, 2024. do not change this unless explicitly requested by the user
// Check if API key is available
if (!process.env.OPENAI_API_KEY) {
  console.error("OPENAI_API_KEY is not set in environment variables");
}

const openai = new OpenAI({ 
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 30000, // 30 second timeout
});

export interface QuizQuestion {
  question: string;
  answers: string[];
  correctAnswer: number;
  timeLimit: number;
}

export interface GeneratedQuiz {
  title: string;
  description: string;
  questions: QuizQuestion[];
}

export async function generateQuizFromPDF(pdfBuffer: Buffer): Promise<GeneratedQuiz> {
  try {
    // Use require for CommonJS module to avoid file loading issues
    const pdfParse = require("pdf-parse");
    
    // Extract text from PDF
    const pdfData = await pdfParse(pdfBuffer);
    const content = pdfData.text;

    if (!content || content.trim().length < 100) {
      throw new Error("PDF content is too short or empty to generate a meaningful quiz");
    }

    return await generateQuizFromContent(content, "PDF Document");
  } catch (error) {
    console.error("PDF processing error:", error);
    throw new Error(`Failed to process PDF: ${error.message}`);
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
  } catch (error) {
    if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      throw new Error("Unable to access the URL. Please check if the URL is correct and accessible.");
    }
    throw new Error(`Failed to process URL: ${error.message}`);
  }
}

export async function generateQuizFromTopics(topics: string): Promise<GeneratedQuiz> {
  try {
    if (!topics || topics.trim().length < 3) {
      throw new Error("Topics input is too short. Please provide specific topics or subjects.");
    }

    const prompt = `Create a comprehensive educational quiz based on the following topics or subjects: "${topics.trim()}"

Requirements:
1. Generate 8-12 multiple choice questions covering the specified topics
2. Each question should have exactly 4 answer options with only one correct answer
3. Include a mix of difficulty levels (easy, medium, hard) appropriate for the subject matter
4. Questions should test various aspects: definitions, concepts, applications, and factual knowledge
5. Ensure questions are educationally valuable and accurate
6. Generate an appropriate quiz title and description based on the topics
7. Questions should be clear, unambiguous, and well-formatted
8. Cover different subtopics within the main topic area when possible

Respond with JSON in this exact format:
{
  "title": "Quiz title based on the topics",
  "description": "Brief description of what this quiz covers",
  "questions": [
    {
      "question": "Question text here?",
      "answers": ["Option A", "Option B", "Option C", "Option D"],
      "correctAnswer": 0,
      "timeLimit": 10
    }
  ]
}`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "You are an expert educator and quiz creator. Create engaging, educational quizzes on any topic with accurate information and well-structured questions. Always respond with valid JSON matching the exact format requested."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      response_format: { type: "json_object" },
      temperature: 0.7,
      max_tokens: 3000
    });

    const generatedContent = response.choices[0].message.content;
    const parsedQuiz = JSON.parse(generatedContent);

    // Validate the response structure
    if (!parsedQuiz.questions || !Array.isArray(parsedQuiz.questions) || parsedQuiz.questions.length === 0) {
      throw new Error("Generated quiz has invalid structure - no questions found");
    }

    // Validate each question
    for (const question of parsedQuiz.questions) {
      if (!question.question || 
          !question.answers || 
          !Array.isArray(question.answers) || 
          question.answers.length !== 4 ||
          typeof question.correctAnswer !== 'number' ||
          question.correctAnswer < 0 || 
          question.correctAnswer >= 4) {
        throw new Error("Generated quiz has invalid question structure");
      }
    }

    return {
      title: parsedQuiz.title || `Quiz: ${topics}`,
      description: parsedQuiz.description || `Educational quiz covering: ${topics}`,
      questions: parsedQuiz.questions.map((q: any) => ({
        question: q.question,
        answers: q.answers,
        correctAnswer: q.correctAnswer,
        timeLimit: q.timeLimit || 10
      }))
    };

  } catch (error: any) {
    console.error("Topics quiz generation error:", error);
    
    // Handle specific OpenAI API errors
    if (error.status === 401) {
      throw new Error("OpenAI API authentication failed. Please check API key configuration.");
    }
    if (error.status === 429) {
      throw new Error("OpenAI API rate limit exceeded. Please try again in a few minutes.");
    }
    if (error.status === 500) {
      throw new Error("OpenAI API service is temporarily unavailable. Please try again later.");
    }
    if (error.code === 'insufficient_quota') {
      throw new Error("OpenAI API quota exceeded. Please check your account usage.");
    }
    
    if (error.message?.includes('JSON')) {
      throw new Error("Failed to generate properly formatted quiz. Please try again with more specific topics.");
    }
    throw new Error(`Failed to generate quiz from topics: ${error.message}`);
  }
}

async function generateQuizFromContent(content: string, sourceTitle: string): Promise<GeneratedQuiz> {
  try {
    // Limit content length to avoid token limits
    const maxContentLength = 8000;
    const truncatedContent = content.length > maxContentLength 
      ? content.substring(0, maxContentLength) + "..."
      : content;

    const prompt = `Based on the following content, create a comprehensive quiz with 8-12 multiple choice questions. Each question should have exactly 4 answer options with only one correct answer.

Content Title: ${sourceTitle}
Content: ${truncatedContent}

Requirements:
1. Questions should test understanding of key concepts, facts, and details from the content
2. Include a mix of difficulty levels (easy, medium, hard)
3. Each question must have exactly 4 answer choices
4. Mark the correct answer clearly
5. Questions should be clear and unambiguous
6. Avoid trick questions or overly complex wording
7. Generate an appropriate quiz title and description

Respond with JSON in this exact format:
{
  "title": "Quiz title based on content",
  "description": "Brief description of what this quiz covers",
  "questions": [
    {
      "question": "Question text here?",
      "answers": ["Option A", "Option B", "Option C", "Option D"],
      "correctAnswer": 0,
      "timeLimit": 10
    }
  ]
}`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "You are an expert quiz creator. Create engaging, educational quizzes based on provided content. Always respond with valid JSON matching the exact format requested."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      response_format: { type: "json_object" },
      temperature: 0.7,
      max_tokens: 3000
    });

    const result = JSON.parse(response.choices[0].message.content);

    // Validate the response structure
    if (!result.title || !result.description || !Array.isArray(result.questions)) {
      throw new Error("Invalid response format from AI service");
    }

    // Validate each question
    for (const question of result.questions) {
      if (!question.question || !Array.isArray(question.answers) || 
          question.answers.length !== 4 || 
          typeof question.correctAnswer !== 'number' ||
          question.correctAnswer < 0 || question.correctAnswer > 3) {
        throw new Error("Invalid question format in AI response");
      }
      
      // Set default time limit if not provided
      if (!question.timeLimit) {
        question.timeLimit = 10;
      }
    }

    // Limit to 12 questions maximum
    if (result.questions.length > 12) {
      result.questions = result.questions.slice(0, 12);
    }

    return result as GeneratedQuiz;
  } catch (error: any) {
    console.error("Content quiz generation error:", error);
    
    // Handle specific OpenAI API errors
    if (error.status === 401) {
      throw new Error("OpenAI API authentication failed. Please check API key configuration.");
    }
    if (error.status === 429) {
      throw new Error("OpenAI API rate limit exceeded. Please try again in a few minutes.");
    }
    if (error.status === 500) {
      throw new Error("OpenAI API service is temporarily unavailable. Please try again later.");
    }
    if (error.code === 'insufficient_quota') {
      throw new Error("OpenAI API quota exceeded. Please check your account usage.");
    }
    
    if (error.message.includes("Invalid response format") || error.message.includes("Invalid question format")) {
      throw error;
    }
    throw new Error(`Failed to generate quiz using AI: ${error.message}`);
  }
}

export async function generateQuizFromText(text: string): Promise<GeneratedQuiz> {
  try {
    if (!text || text.trim().length < 50) {
      throw new Error("Text content is too short to generate a meaningful quiz");
    }

    return await generateQuizFromContent(text, "Text Content");
  } catch (error: any) {
    console.error("Text quiz generation error:", error);
    
    // Handle specific OpenAI API errors
    if (error.status === 401) {
      throw new Error("OpenAI API authentication failed. Please check API key configuration.");
    }
    if (error.status === 429) {
      throw new Error("OpenAI API rate limit exceeded. Please try again in a few minutes.");
    }
    if (error.status === 500) {
      throw new Error("OpenAI API service is temporarily unavailable. Please try again later.");
    }
    if (error.code === 'insufficient_quota') {
      throw new Error("OpenAI API quota exceeded. Please check your account usage.");
    }
    
    if (error.message?.includes('Text content is too short') || error.message?.includes('Invalid response format') || error.message?.includes('Invalid question format')) {
      throw error;
    }
    throw new Error(`Failed to generate quiz from text: ${error.message}`);
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

    const response = await openai.images.generate({
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