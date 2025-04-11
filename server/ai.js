import { generateText } from "ai";
import { google } from "@ai-sdk/google";
import dotenv from "dotenv";

dotenv.config();

/**
 * Process text using Google's Gemini model and return the generated output
 * @param {string} inputText - The text input to process
 * @returns {Promise<string>} - The generated text response
 */
export async function useLLM(inputText) {
  try {
    // Check for API key in environment variables
    if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
      throw new Error('Google Generative AI API key is missing. Set the GOOGLE_GENERATIVE_AI_API_KEY environment variable.');
    }

    const { text } = await generateText({
      model: google("models/gemini-2.0-flash-exp", {
        apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY
      }),
      prompt: inputText
    });
    
    return text;
  } catch (error) {
    console.error('Error processing text with Gemini:', error);
    throw error;
  }
}

// Example usage:
/*
import { useLLM } from "./ai";

// Simple text processing
const response = await useLLM("What is love?");
console.log(response); // Prints the generated text response
*/
