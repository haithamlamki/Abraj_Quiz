import OpenAI from "openai";
// Dynamic import for pdf-parse to avoid file loading issues at startup
import axios from "axios";
import * as cheerio from "cheerio";

// the newest OpenAI model is "gpt-4o" which was released May 13, 2024. do not change this unless explicitly requested by the user
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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
  } catch (error) {
    if (error.message.includes("Invalid response format") || error.message.includes("Invalid question format")) {
      throw error;
    }
    throw new Error(`Failed to generate quiz using AI: ${error.message}`);
  }
}