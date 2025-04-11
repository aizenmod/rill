// write a simple http server express app 
// make the endpoints as follows : 1. this endpoint is called "understand" and it takes in the message that user sends, gives the prompt to the LLM to understand the user's intent, makes a plan on what to do, or else if not clear prompts the user back to make it clear, and then returns the intent. 2. this endpoint is called "act" and it takes in the intent and the message, and then returns the response from the LLM. for now dont write the code for LLM, just write the code for the endpoints.

import express from 'express';
import { json } from 'express';
import cors from 'cors';
import { useLLM } from './ai.js';
import { 
  commandGeneratorPrompt, 
  codeGeneratorPrompt, 
  createCommandPrompt, 
  createCodePrompt 
} from './prompts.js';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(json());

/**
 * Extract JSON from a string that might contain markdown formatting
 * @param {string} text - The text that may contain JSON within markdown
 * @returns {object} - The parsed JSON object
 */
function extractJSON(text) {
  // Check if the response contains a code block
  const jsonRegex = /```(?:json)?\s*(\{[\s\S]*?\})\s*```/;
  const match = text.match(jsonRegex);
  
  if (match && match[1]) {
    // If we found JSON in a code block, parse that
    return JSON.parse(match[1]);
  }
  
  // If no code block is found, try to find JSON directly
  const jsonStart = text.indexOf('{');
  const jsonEnd = text.lastIndexOf('}');
  
  if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
    const jsonStr = text.substring(jsonStart, jsonEnd + 1);
    return JSON.parse(jsonStr);
  }
  
  // If we can't extract JSON, throw an error
  throw new Error('Could not extract valid JSON from the response');
}

// Understand intent using the AI model
async function understandIntent(message) {
  const prompt = `
    You are an AI assistant tasked with understanding the user's intent from their message.
    Your job is to analyze the message and determine if it's:
    1. A request to generate terminal commands
    2. A request to generate code
    3. A general question or other request
    
    RESPOND WITH ONLY A JSON OBJECT with the following structure:
    {
      "understood": true,
      "type": "command_generation" | "code_generation" | "general_request",
      "details": "Detailed description of what the user wants",
      "requiresMoreInfo": false,
      "clarificationQuestion": null
    }
    
    If the intent is unclear or you need more information, return:
    {
      "understood": false,
      "type": null,
      "details": "Why the intent is unclear",
      "requiresMoreInfo": true,
      "clarificationQuestion": "Question to ask the user for clarification"
    }
    
    DO NOT include any explanations, markdown formatting, or extra text. Return ONLY the JSON object.
    
    USER MESSAGE: ${message}
  `;
  
  try {
    const response = await useLLM(prompt);
    try {
      // First try regular JSON parsing
      return JSON.parse(response);
    } catch (error) {
      // If that fails, try to extract the JSON from markdown
      return extractJSON(response);
    }
  } catch (error) {
    console.error('Error parsing AI response:', error);
    // Fallback response if parsing fails
    return {
      understood: false,
      type: null,
      details: "Failed to parse the intent",
      requiresMoreInfo: true,
      clarificationQuestion: "Could you please clarify what you're looking for?"
    };
  }
}

// Execute action based on the intent
async function executeAction(intent, message) {
  try {
    switch (intent.type) {
      case 'command_generation': {
        // Generate terminal commands
        const context = {
          userRequest: message,
          intentDetails: intent.details
        };
        
        const commandPrompt = createCommandPrompt(context);
        const response = await useLLM(commandPrompt);
        
        try {
          // First try regular JSON parsing
          return {
            result: JSON.parse(response),
            actionTaken: 'command_generation',
            success: true
          };
        } catch (error) {
          // If that fails, try to extract the JSON
          try {
            return {
              result: extractJSON(response),
              actionTaken: 'command_generation',
              success: true
            };
          } catch (jsonError) {
            console.error('Error parsing command response:', jsonError);
            return {
              result: response,
              actionTaken: 'command_generation',
              success: false,
              error: 'Failed to generate valid command JSON'
            };
          }
        }
      }
      
      case 'code_generation': {
        // Generate code
        const requirements = {
          userRequest: message,
          intentDetails: intent.details
        };
        
        const codePrompt = createCodePrompt(requirements);
        const response = await useLLM(codePrompt);
        
        try {
          // First try regular JSON parsing
          return {
            result: JSON.parse(response),
            actionTaken: 'code_generation',
            success: true
          };
        } catch (error) {
          // If that fails, try to extract the JSON
          try {
            return {
              result: extractJSON(response),
              actionTaken: 'code_generation',
              success: true
            };
          } catch (jsonError) {
            console.error('Error parsing code response:', jsonError);
            return {
              result: response,
              actionTaken: 'code_generation',
              success: false,
              error: 'Failed to generate valid code JSON'
            };
          }
        }
      }
      
      case 'general_request': {
        // Handle general requests
        const prompt = `
          You are a helpful AI assistant. Please respond to the following request:
          ${message}
        `;
        
        const response = await useLLM(prompt);
        return {
          result: response,
          actionTaken: 'general_request',
          success: true
        };
      }
      
      default:
        return {
          result: 'Unknown intent type',
          actionTaken: 'none',
          success: false
        };
    }
  } catch (error) {
    console.error('Error executing action:', error);
    return {
      result: null,
      actionTaken: 'none',
      success: false,
      error: error.message
    };
  }
}

// Understand endpoint - Takes user message and returns intent
app.post('/understand', async (req, res) => {
  try {
    const { message } = req.body;
    
    if (!message) {
      return res.status(400).json({ 
        error: 'Message is required' 
      });
    }
    
    const intent = await understandIntent(message);
    return res.status(200).json({ intent });
  } catch (error) {
    console.error('Error in understand endpoint:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
});

// Act endpoint - Takes intent and message, returns LLM response
app.post('/act', async (req, res) => {
  try {
    const { intent, message } = req.body;
    
    if (!intent || !message) {
      return res.status(400).json({ 
        error: 'Both intent and message are required' 
      });
    }
    
    const response = await executeAction(intent, message);
    return res.status(200).json({ response });
  } catch (error) {
    console.error('Error in act endpoint:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
});

// Terminal command execution endpoint
app.post('/api/execute', async (req, res) => {
  try {
    const { command } = req.body;
    
    if (!command) {
      return res.status(400).json({ 
        error: 'Command is required' 
      });
    }
    
    console.log(`Executing command: ${command}`);
    
    // Set headers for streaming response
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Transfer-Encoding', 'chunked');
    
    // Import the child_process module
    const { exec } = await import('child_process');
    
    // Execute the command
    const childProcess = exec(command);
    
    // Stream stdout to response
    childProcess.stdout.on('data', (data) => {
      res.write(data);
    });
    
    // Stream stderr to response
    childProcess.stderr.on('data', (data) => {
      res.write(data);
    });
    
    // Handle command completion
    childProcess.on('close', (code) => {
      res.write(`\r\nProcess exited with code ${code}\r\n`);
      res.end();
    });
    
    // Handle errors
    childProcess.on('error', (error) => {
      res.write(`\r\nError: ${error.message}\r\n`);
      res.end();
    });
  } catch (error) {
    console.error('Error in execute endpoint:', error);
    res.write(`\r\nServer Error: ${error.message}\r\n`);
    res.end();
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'Server is running' });
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

export default app;