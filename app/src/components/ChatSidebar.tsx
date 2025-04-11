import React, { useState, useRef, useEffect } from 'react';
import './ChatSidebar.css';
import { webcontainerService } from '../services';
import Terminal from './Terminal';
import 'xterm/css/xterm.css';

interface Message {
  sender: 'user' | 'assistant';
  content: string;
  type?: 'text' | 'code' | 'command';
  actionTaken?: string;
  commandExecuting?: boolean;
  commandCompleted?: boolean;
}

interface Intent {
  understood: boolean;
  type: string | null;
  details: string;
  requiresMoreInfo: boolean;
  clarificationQuestion: string | null;
}

interface CodeFile {
  filename: string;
  content: string;
}

interface ChatSidebarProps {
  isVisible: boolean;
  onClose: () => void;
  onRunCommand?: (command: string) => Promise<boolean>;
  onSaveCode?: (files: CodeFile[]) => void;
  onFileSelect?: (path: string) => void;
}

const API_URL = 'http://localhost:3000'; // Update this to match your server URL

const ChatSidebar: React.FC<ChatSidebarProps> = ({ 
  isVisible, 
  onClose, 
  onRunCommand,
  onSaveCode,
  onFileSelect
}) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [workflowState, setWorkflowState] = useState<'idle' | 'planning' | 'commands' | 'code_generation' | 'complete'>('idle');
  const [projectContext, setProjectContext] = useState<any>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom of messages when they change
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Execute a command in the terminal and wait for it to complete
  const executeCommand = async (command: string): Promise<boolean> => {
    try {
      // Find the message index with this command and update it
      const messageIndex = messages.findIndex(
        m => m.type === 'command' && m.content.includes(command)
      );
      
      if (messageIndex >= 0) {
        // Update the message to show executing status
        const updatedMessages = [...messages];
        updatedMessages[messageIndex] = {
          ...updatedMessages[messageIndex],
          commandExecuting: true
        };
        setMessages(updatedMessages);
      }
      
      // Make sure WebContainer service is ready
      if (!webcontainerService.getInstance()) {
        console.error('WebContainer not initialized. Waiting for initialization...');
        
        // Wait for WebContainer to be ready with timeout
        let containerReady = false;
        const waitForWebContainer = new Promise<void>((resolve) => {
          const handleReady = () => {
            containerReady = true;
            window.removeEventListener('webcontainer-ready', handleReady);
            resolve();
          };
          
          window.addEventListener('webcontainer-ready', handleReady);
          
          // Timeout after 10 seconds
          setTimeout(() => {
            window.removeEventListener('webcontainer-ready', handleReady);
            if (!containerReady) {
              console.error('Timed out waiting for WebContainer');
            }
            resolve();
          }, 10000);
        });
        
        await waitForWebContainer;
        
        // Check again after waiting
        if (!webcontainerService.getInstance()) {
          throw new Error('WebContainer initialization failed');
        }
      }
      
      // Execute the command in the main terminal if onRunCommand is available
      let success = false;
      if (onRunCommand) {
        success = await onRunCommand(command);
        
        // If command failed, retry once after a short delay
        if (!success) {
          console.log('Command failed, retrying after delay...');
          await new Promise(resolve => setTimeout(resolve, 2000));
          success = await onRunCommand(command);
        }
      } else {
        // Fallback for testing/development
        console.log('No terminal available for command:', command);
        await new Promise(resolve => setTimeout(resolve, 2000));
        success = true;
      }
      
      // Update the message to show completed status
      if (messageIndex >= 0) {
        setMessages(prev => {
          const updatedMessages = [...prev];
          updatedMessages[messageIndex] = {
            ...updatedMessages[messageIndex],
            commandExecuting: false,
            commandCompleted: true
          };
          return updatedMessages;
        });
      }
      
      return success;
    } catch (error) {
      console.error('Error executing command:', error);
      return false;
    }
  };

  // Get current directory structure
  const getDirectoryStructure = async (): Promise<any> => {
    try {
      const dirStructure = await webcontainerService.getDirectoryTree();
      return dirStructure;
    } catch (error) {
      console.error('Error getting directory structure:', error);
      return {};
    }
  };

  // Create or update files in the webcontainer
  const createFiles = async (files: CodeFile[]): Promise<boolean> => {
    try {
      // Process files in two phases:
      // 1. First, create all directories to ensure they exist
      // 2. Then write all files
      
      // Phase 1: Create directories first
      const directories = new Set<string>();
      files.forEach(file => {
        const dirPath = file.filename.split('/').slice(0, -1).join('/');
        if (dirPath) {
          directories.add(dirPath);
        }
      });
      
      // Create all directories first
      for (const dirPath of directories) {
        try {
          await webcontainerService.createDirectory(dirPath);
        } catch (error) {
          // Directory might already exist, continue
          console.log(`Directory ${dirPath} might already exist, continuing...`);
        }
      }
      
      // Phase 2: Write all files after directories are created
      for (const file of files) {
        // Write file
        await webcontainerService.writeFile(file.filename, file.content);
        
        // Open the first file in the editor after a short delay
        if (onFileSelect && files.indexOf(file) === 0) {
          setTimeout(() => {
            onFileSelect(file.filename);
          }, 500);
        }
      }
      
      // Dispatch event to refresh file tree
      window.dispatchEvent(new CustomEvent('terminal-command-executed'));
      
      return true;
    } catch (error) {
      console.error('Error creating files:', error);
      return false;
    }
  };

  // Process user message through the AI API
  const processMessage = async (message: string) => {
    try {
      setIsLoading(true);
      setError(null);
      
      // First call the 'understand' endpoint to get intent
      const understandResponse = await fetch(`${API_URL}/understand`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message }),
      });
      
      if (!understandResponse.ok) {
        throw new Error(`Error understanding intent: ${understandResponse.statusText}`);
      }
      
      const understandData = await understandResponse.json();
      const intent: Intent = understandData.intent;
      
      // If the LLM needs more info, show clarification question
      if (intent.requiresMoreInfo && intent.clarificationQuestion) {
        setMessages(prev => [...prev, {
          sender: 'assistant',
          content: intent.clarificationQuestion as string,
          type: 'text'
        }]);
        setIsLoading(false);
        return;
      }
      
      // Show the user what we understood their intent to be
      if (intent.understood && intent.details) {
        setMessages(prev => [...prev, {
          sender: 'assistant',
          content: `I understand you want to ${intent.details}. Let me help with that.`,
          type: 'text'
        }]);
      }
      
      // For code generation, start the project generation workflow
      if (intent.type === 'code_generation') {
        await startProjectWorkflow(message, intent);
      } else {
        // For other intents, proceed normally with the 'act' endpoint
        await processNormalIntent(intent, message);
      }
      
    } catch (err) {
      console.error('Error processing message:', err);
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
      
      // Show error to the user
      setMessages(prev => [...prev, {
        sender: 'assistant',
        content: `Sorry, I encountered an error: ${err instanceof Error ? err.message : 'Unknown error'}`,
        type: 'text'
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  // Start the multi-step project generation workflow
  const startProjectWorkflow = async (message: string, intent: Intent) => {
    try {
      // Step 1: Planning phase
      setWorkflowState('planning');
      setMessages(prev => [...prev, {
        sender: 'assistant',
        content: 'I\'ll help you set up this project. First, let me plan the structure...',
        type: 'text'
      }]);
      
      // Before executing any commands, ensure WebContainer is initialized
      const webcontainerInstance = webcontainerService.getInstance();
      if (!webcontainerInstance) {
        setMessages(prev => [...prev, {
          sender: 'assistant',
          content: 'Initializing WebContainer environment. This may take a moment...',
          type: 'text'
        }]);
        
        // Wait for WebContainer to be ready
        await new Promise<void>((resolve) => {
          const handleReady = () => {
            window.removeEventListener('webcontainer-ready', handleReady);
            resolve();
          };
          
          if (webcontainerService.getInstance()) {
            resolve();
          } else {
            window.addEventListener('webcontainer-ready', handleReady);
            
            // Timeout after 15 seconds
            setTimeout(() => {
              window.removeEventListener('webcontainer-ready', handleReady);
              resolve();
            }, 15000);
          }
        });
        
        // Check again after waiting
        if (!webcontainerService.getInstance()) {
          throw new Error('WebContainer initialization failed or timed out');
        }
      }
      
      // Call the AI to create a project plan
      const planPrompt = `
        You are a software architect planning a project based on this request:
        "${message}"
        
        Create a project plan with:
        1. A list of dependencies to install
        2. A file structure with key files
        3. A description of the main components
        
        FORMAT YOUR RESPONSE AS JSON with this structure:
        {
          "projectName": "name of the project",
          "description": "brief description",
          "dependencies": ["list", "of", "dependencies"],
          "devDependencies": ["list", "of", "dev", "dependencies"],
          "fileStructure": [
            { "path": "file/path.ext", "description": "what this file does" }
          ],
          "components": [
            { "name": "ComponentName", "purpose": "what this component does" }
          ]
        }
        
        DO NOT include any text outside of the JSON structure. Return ONLY the JSON object.
      `;
      
      const planResponse = await useLLM(planPrompt);
      // Extract and parse the JSON from the response
      let projectPlan;
      try {
        projectPlan = extractJSON(planResponse);
        setProjectContext(projectPlan);
        
        // Display the plan to the user
        setMessages(prev => [...prev, {
          sender: 'assistant',
          content: `I've created a plan for your ${projectPlan.projectName} project:\n\n` +
                   `**Description**: ${projectPlan.description}\n\n` +
                   `**Dependencies**: ${projectPlan.dependencies.join(', ')}\n\n` +
                   `**File Structure**:\n${projectPlan.fileStructure.map(f => `- ${f.path}`).join('\n')}\n\n` +
                   `I'll now set up the project structure and install dependencies...`,
          type: 'text'
        }]);
      } catch (error) {
        throw new Error(`Could not parse project plan: ${error.message}`);
      }
      
      // Step 2: Generate and execute setup commands
      setWorkflowState('commands');
      
      // Create command for project initialization
      const initPrompt = `
        Generate a command to initialize a new ${projectPlan.projectName} project.
        Use npm or pnpm or yarn based on what's most appropriate for this type of project.
      `;
      
      const commandContext = {
        userRequest: initPrompt,
        projectPlan: projectPlan,
        currentState: "initializing project"
      };
      
      const initCommandResponse = await fetch(`${API_URL}/act`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          intent: {
            understood: true,
            type: 'command_generation',
            details: 'generate a command to initialize the project',
            requiresMoreInfo: false
          }, 
          message: JSON.stringify(commandContext)
        }),
      });
      
      if (!initCommandResponse.ok) {
        throw new Error(`Error generating init command: ${initCommandResponse.statusText}`);
      }
      
      const initCommandData = await initCommandResponse.json();
      let initCommand = '';
      let initSuccess = false;
      
      try {
        const commandObj = typeof initCommandData.response.result === 'string' 
          ? JSON.parse(initCommandData.response.result) 
          : initCommandData.response.result;
          
        if (commandObj && commandObj.command) {
          initCommand = commandObj.command;
          
          setMessages(prev => [...prev, {
            sender: 'assistant',
            content: `Initializing project with command:\n\`\`\`\n${initCommand}\n\`\`\``,
            type: 'command'
          }]);
          
          // Execute the initialization command and wait for completion
          initSuccess = await executeCommand(initCommand);
          if (!initSuccess) {
            throw new Error("Project initialization failed");
          }
        }
      } catch (error) {
        console.error('Error parsing init command:', error);
        throw new Error(`Failed to generate valid initialization command: ${error.message}`);
      }
      
      // Step 3: Install dependencies
      let dependenciesInstalled = false;
      if (projectPlan.dependencies.length > 0 || projectPlan.devDependencies.length > 0) {
        // Generate dependency installation command
        const dependencyPrompt = `
          Generate a command to install these dependencies: ${projectPlan.dependencies.join(', ')}
          And these dev dependencies: ${projectPlan.devDependencies.join(', ')}
          Use the appropriate package manager (npm, yarn, or pnpm).
        `;
        
        const depCommandContext = {
          userRequest: dependencyPrompt,
          projectPlan: projectPlan,
          currentState: "installing dependencies"
        };
        
        const depCommandResponse = await fetch(`${API_URL}/act`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ 
            intent: {
              understood: true,
              type: 'command_generation',
              details: 'generate a command to install dependencies',
              requiresMoreInfo: false
            }, 
            message: JSON.stringify(depCommandContext)
          }),
        });
        
        if (!depCommandResponse.ok) {
          throw new Error(`Error generating dependency command: ${depCommandResponse.statusText}`);
        }
        
        const depCommandData = await depCommandResponse.json();
        
        try {
          const commandObj = typeof depCommandData.response.result === 'string' 
            ? JSON.parse(depCommandData.response.result) 
            : depCommandData.response.result;
            
          if (commandObj && commandObj.command) {
            const depCommand = commandObj.command;
            
            setMessages(prev => [...prev, {
              sender: 'assistant',
              content: `Installing dependencies with command:\n\`\`\`\n${depCommand}\n\`\`\``,
              type: 'command'
            }]);
            
            // Execute the dependency installation command and wait for it to complete
            dependenciesInstalled = await executeCommand(depCommand);
          }
        } catch (error) {
          console.error('Error parsing dependency command:', error);
          throw new Error(`Failed to generate valid dependency installation command: ${error.message}`);
        }
      } else {
        // If there are no dependencies, mark as installed
        dependenciesInstalled = true;
      }
      
      // Step 4: Get directory structure after setup is complete
      if (dependenciesInstalled) {
        // Read the current directory structure
        const directoryStructure = await getDirectoryStructure();
        
        // Generate code for the project with directory structure info
        setWorkflowState('code_generation');
        setMessages(prev => [...prev, {
          sender: 'assistant',
          content: `Now generating code for your ${projectPlan.projectName} project based on the current structure...`,
          type: 'text'
        }]);
        
        // Call the code generation endpoint with directory structure
        const codeGenContext = {
          userRequest: message,
          projectPlan: projectPlan,
          currentState: "generating code files",
          directoryStructure: directoryStructure
        };
        
        const codeGenResponse = await fetch(`${API_URL}/act`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ 
            intent: {
              understood: true,
              type: 'code_generation',
              details: 'generate code files for the project',
              requiresMoreInfo: false
            }, 
            message: JSON.stringify(codeGenContext) 
          }),
        });
        
        if (!codeGenResponse.ok) {
          throw new Error(`Error generating code: ${codeGenResponse.statusText}`);
        }
        
        const codeGenData = await codeGenResponse.json();
        
        try {
          const codeResult = typeof codeGenData.response.result === 'string' 
            ? extractJSON(codeGenData.response.result)
            : codeGenData.response.result;
          
          if (codeResult && codeResult.files && Array.isArray(codeResult.files)) {
            // Create files in the webcontainer
            await createFiles(codeResult.files);
            
            // Show summary message
            const fileNames = codeResult.files.map((file: CodeFile) => file.filename).join(', ');
            setMessages(prev => [...prev, {
              sender: 'assistant',
              content: `I've created the following files for your project:\n${codeResult.files.map((file: CodeFile) => `- ${file.filename}`).join('\n')}\n\nYou can now view and edit these files in the editor.`,
              type: 'text'
            }]);
            
            // Step 5: Workflow complete
            setWorkflowState('complete');
          } else {
            throw new Error('Invalid code generation result');
          }
        } catch (error) {
          console.error('Error processing code generation:', error);
          throw new Error(`Failed to generate valid code: ${error.message}`);
        }
      } else {
        throw new Error("Dependencies installation failed or was not completed. Cannot proceed with code generation.");
      }
      
    } catch (error) {
      console.error('Error in project workflow:', error);
      setMessages(prev => [...prev, {
        sender: 'assistant',
        content: `Sorry, I encountered an error while setting up your project: ${error.message}`,
        type: 'text'
      }]);
      setWorkflowState('idle');
    }
  };

  // Extract JSON from a string that might contain markdown formatting
  function extractJSON(text: string) {
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

  // Process a normal intent (not a code generation workflow)
  const processNormalIntent = async (intent: Intent, message: string) => {
    // Call the 'act' endpoint
    const actResponse = await fetch(`${API_URL}/act`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ intent, message }),
    });
    
    if (!actResponse.ok) {
      throw new Error(`Error getting response: ${actResponse.statusText}`);
    }
    
    const actData = await actResponse.json();
    const response = actData.response;
    
    // Handle different response types
    let messageContent = '';
    let messageType: 'text' | 'code' | 'command' = 'text';
    
    if (response.actionTaken === 'command_generation' && response.success) {
      // For command generation responses
      try {
        const commandObj = typeof response.result === 'string' 
          ? JSON.parse(response.result) 
          : response.result;
          
        if (commandObj && commandObj.command) {
          messageContent = `Here's the command you need:\n\`\`\`\n${commandObj.command}\n\`\`\``;
          messageType = 'command';
        } else {
          messageContent = typeof response.result === 'string' 
            ? response.result 
            : JSON.stringify(response.result, null, 2);
        }
      } catch (error) {
        messageContent = typeof response.result === 'string' 
          ? response.result 
          : JSON.stringify(response.result, null, 2);
      }
    } else if (response.actionTaken === 'code_generation' && response.success) {
      // For code generation responses
      try {
        const codeObj = typeof response.result === 'string' 
          ? JSON.parse(response.result) 
          : response.result;
          
        if (codeObj && codeObj.files && Array.isArray(codeObj.files)) {
          // Create a nicely formatted message with the code
          messageContent = "Here's the code I've generated:\n\n";
          
          codeObj.files.forEach((file: CodeFile) => {
            messageContent += `**File: ${file.filename}**\n\`\`\`\n${file.content}\n\`\`\`\n\n`;
          });
          
          messageType = 'code';
        } else {
          messageContent = typeof response.result === 'string' 
            ? response.result 
            : JSON.stringify(response.result, null, 2);
        }
      } catch (error) {
        messageContent = typeof response.result === 'string' 
          ? response.result 
          : JSON.stringify(response.result, null, 2);
      }
    } else {
      // For general responses or errors
      messageContent = typeof response.result === 'string' 
        ? response.result 
        : JSON.stringify(response.result, null, 2);
    }
    
    // Add assistant's response to the messages
    setMessages(prev => [...prev, {
      sender: 'assistant',
      content: messageContent,
      type: messageType,
      actionTaken: response.actionTaken
    }]);
  };

  // Calls the AI model with a prompt
  const useLLM = async (prompt: string): Promise<string> => {
    const response = await fetch(`${API_URL}/act`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 
        intent: {
          understood: true,
          type: 'general_request',
          details: 'direct prompt to AI',
          requiresMoreInfo: false
        }, 
        message: prompt 
      }),
    });
    
    if (!response.ok) {
      throw new Error(`Error calling LLM: ${response.statusText}`);
    }
    
    const data = await response.json();
    return typeof data.response.result === 'string' 
      ? data.response.result 
      : JSON.stringify(data.response.result);
  };

  const handleSendMessage = async () => {
    if (inputText.trim()) {
      // Add user message to the chat
      const userMessage = inputText.trim();
      setMessages(prev => [...prev, { sender: 'user', content: userMessage, type: 'text' }]);
      setInputText('');
      
      // Process the message through the API
      await processMessage(userMessage);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleCompile = () => {
    // Add a user message about compiling
    const compileMessage = "Compile my code";
    setMessages(prev => [...prev, { sender: 'user', content: compileMessage, type: 'text' }]);
    
    // Process the compile request
    processMessage(compileMessage);
  };

  const handleDeploy = () => {
    // Add a user message about deploying
    const deployMessage = "Deploy my code on Sepolia";
    setMessages(prev => [...prev, { sender: 'user', content: deployMessage, type: 'text' }]);
    
    // Process the deploy request
    processMessage(deployMessage);
  };

  // Function to handle running a command
  const handleRunCommand = (command: string) => {
    executeCommand(command);
  };

  // Helper function to format message content with markdown-like syntax
  const formatMessageContent = (content: string, type?: string, commandExecuting?: boolean) => {
    if (type === 'code' || type === 'command') {
      // Split content to identify code blocks
      const parts = content.split(/```([\s\S]*?)```/);
      
      return (
        <div>
          {parts.map((part, index) => {
            if (index % 2 === 0) {
              // Text part - Could contain markdown-like syntax for bold, etc.
              return <div key={index} dangerouslySetInnerHTML={{ 
                __html: part
                  .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                  .replace(/\n/g, '<br />') 
              }} />;
            } else {
              // Code part
              return (
                <pre key={index} className="code-block">
                  <code>{part}</code>
                  {type === 'command' && !commandExecuting && (
                    <button 
                      className="run-command-button"
                      onClick={() => handleRunCommand(part.trim())}
                    >
                      Run Command
                    </button>
                  )}
                </pre>
              );
            }
          })}
        </div>
      );
    }
    
    // Regular text
    return <p>{content}</p>;
  };

  return (
    <div className={`chat-sidebar ${isVisible ? 'visible' : 'hidden'}`}>
      <div className="chat-header">
        <h3>AI Assistant</h3>
        <div className="chat-actions">
          <button 
            className="chat-button compile-button" 
            onClick={handleCompile}
            disabled={isLoading}
          >
            Compile
          </button>
          <button 
            className="chat-button deploy-button" 
            onClick={handleDeploy}
            disabled={isLoading}
          >
            Deploy on Sepolia
          </button>
          <button 
            className="close-button" 
            onClick={onClose}
          >
            ×
          </button>
        </div>
      </div>
      
      <div className="chat-messages">
        {messages.map((message, index) => (
          <div 
            key={index} 
            className={`message ${message.sender === 'user' ? 'user-message' : 'assistant-message'}`}
          >
            <div className="message-content">
              {formatMessageContent(message.content, message.type, message.commandExecuting)}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="message assistant-message">
            <div className="message-content loading">
              <div className="typing-indicator">
                <span></span>
                <span></span>
                <span></span>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
      
      <div className="chat-input-container">
        <textarea
          className="chat-input"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask me anything..."
          rows={3}
          disabled={isLoading}
        />
        <button 
          className="send-button"
          onClick={handleSendMessage}
          disabled={!inputText.trim() || isLoading}
        >
          Send
        </button>
      </div>
    </div>
  );
};

export default ChatSidebar; 