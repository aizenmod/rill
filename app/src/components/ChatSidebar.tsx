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
  const [workflowState, setWorkflowState] = useState<
    'idle' | 'planning' | 'commands' | 'setup' | 'dependencies' | 'code_generation' | 'complete'
  >('idle');
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
      
      // Check if this is a Vite project creation command that needs special handling
      if (command.includes('npm create vite') || command.includes('npx create-vite')) {
        return await executeNonInteractiveViteCommand(command);
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

  // Execute a Vite project creation command with handling for interactive prompts
  const executeNonInteractiveViteCommand = async (command: string): Promise<boolean> => {
    try {
      // Parse the Vite command to extract project name and template
      const parts = command.split(' ');
      let projectName = 'react-vite-todo';
      let template = 'react-ts';
      
      // Try to extract project name and template from the command
      for (let i = 0; i < parts.length; i++) {
        if (parts[i] === '--template' && i + 1 < parts.length) {
          template = parts[i + 1];
        } else if (!parts[i].startsWith('-') && 
                  !parts[i].startsWith('npm') && 
                  !parts[i].startsWith('npx') && 
                  !parts[i].includes('vite')) {
          projectName = parts[i];
        }
      }
      
      // We'll use the interactive command and let the Terminal component handle the prompts
      const interactiveCommand = `npm create vite@latest ${projectName}`;
      
      setMessages(prev => [...prev, {
        sender: 'assistant',
        content: `Running interactive command:\n\`\`\`\n${interactiveCommand}\n\`\`\`\nThe terminal will automatically respond to prompts as needed.`,
        type: 'text'
      }]);
      
      // Set up event listener for terminal outputs to track progress
      let installationComplete = false;
      let selectedFramework = false;
      let selectedVariant = false;
      
      const terminalOutputHandler = (event: CustomEvent) => {
        const output = event.detail?.output || '';
        
        if (output.includes('Select a framework:')) {
          console.log('Terminal is asking for framework selection');
          selectedFramework = true;
        } else if (output.includes('Select a variant:')) {
          console.log('Terminal is asking for variant selection');
          selectedVariant = true;
        } else if (output.includes('Scaffolding project')) {
          console.log('Project scaffolding in progress');
        } else if (output.includes('Done. Now run:')) {
          console.log('Installation complete');
          installationComplete = true;
        }
      };
      
      window.addEventListener('terminal-output', terminalOutputHandler as EventListener);
      
      // Execute the interactive command
      let success = false;
      if (onRunCommand) {
        success = await onRunCommand(interactiveCommand);
        
        // Wait for the installation to complete
        const maxAttempts = 30; // 30 seconds timeout
        let attempts = 0;
        while (!installationComplete && attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          attempts++;
        }
        
        // If we're still not done after timeout, check if we at least selected the framework
        if (!installationComplete && selectedFramework) {
          success = true; // We'll consider it partial success and continue
        }
      }
      
      // Clean up event listener
      window.removeEventListener('terminal-output', terminalOutputHandler as EventListener);
      
      // If successful, wait a moment and then cd into the project directory
      if (success) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Check if the directory was created
        const dirStructure = await getDirectoryStructure();
        if (dirStructure[projectName]) {
          // CD into the project directory
          const cdCommand = `cd ${projectName}`;
          if (onRunCommand) {
            await onRunCommand(cdCommand);
          }
          
          setMessages(prev => [...prev, {
            sender: 'assistant',
            content: `Project created successfully. Now changing to project directory...`,
            type: 'text'
          }]);
          
          // Wait for cd command to complete
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          // Install dependencies if not already done by the scaffolding tool
          const installCommand = 'npm install';
          
          setMessages(prev => [...prev, {
            sender: 'assistant',
            content: `Installing project dependencies with:\n\`\`\`\n${installCommand}\n\`\`\``,
            type: 'command'
          }]);
          
          if (onRunCommand) {
            await onRunCommand(installCommand);
            // Wait for dependencies to install
            await new Promise(resolve => setTimeout(resolve, 5000));
          }
        } else {
          console.warn(`Project directory ${projectName} not found, continuing anyway`);
          // Try to create it manually as fallback
          if (onRunCommand) {
            await onRunCommand(`mkdir -p ${projectName} && cd ${projectName}`);
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
      }
      
      return success;
    } catch (error) {
      console.error('Error executing interactive Vite command:', error);
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

  // Start the project generation workflow
  const startProjectWorkflow = async (message: string, intent: Intent) => {
    try {
      setWorkflowState('planning');
      setMessages(prev => [...prev, {
        sender: 'assistant',
        content: 'Planning your project structure...',
        type: 'text'
      }]);
      
      // Step 1: Plan project structure
      const planningContext = {
        userRequest: message,
        currentState: "planning"
      };
      
      // Call the planning API
      const planResponse = await fetch(`${API_URL}/plan`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(planningContext),
      });
      
      if (!planResponse.ok) {
        throw new Error(`Error planning project: ${planResponse.statusText}`);
      }
      
      // Start the WebContainer if it's not already started
      if (!webcontainerService.getInstance()) {
        // Wait for WebContainer to be ready with timeout
        let containerReady = false;
        const waitForWebContainer = new Promise<void>((resolve) => {
          const handleReady = () => {
            containerReady = true;
            window.removeEventListener('webcontainer-ready', handleReady);
            resolve();
          };
          
          window.addEventListener('webcontainer-ready', handleReady);
          
          // Timeout after 20 seconds
          setTimeout(() => {
            window.removeEventListener('webcontainer-ready', handleReady);
            if (!containerReady) {
              console.error('Timed out waiting for WebContainer');
            }
            resolve();
          }, 20000);
        });
        
        await waitForWebContainer;
      }
      
      const planData = await planResponse.json();
      const planResult = planData.response.result || '';
      
      // Extract the project plan from the response
      let projectPlan;
      try {
        projectPlan = extractJSON(planResult);
        setProjectContext(projectPlan);
        
        // Display the plan to the user
        setMessages(prev => [...prev, {
          sender: 'assistant',
          content: `I've created a plan for your ${projectPlan.projectName} project:\n\n` +
                   `**Description**: ${projectPlan.description}\n\n` +
                   `**Dependencies**: ${projectPlan.dependencies.join(', ')}\n\n` +
                   `**File Structure**:\n${projectPlan.fileStructure.map(f => `- ${f.path}`).join('\n')}\n\n` +
                   `I'll now set up the project structure...`,
          type: 'text'
        }]);
      } catch (error) {
        throw new Error(`Could not parse project plan: ${error.message}`);
      }
      
      // Step 2: Set up project framework
      setWorkflowState('setup');
      
      // Create a non-interactive command for project initialization
      const projectName = projectPlan.projectName || 'react-vite-todo';
      const template = 'react-ts'; // Default to React TypeScript
      const initCommand = `npm create vite@latest ${projectName} -- --template ${template}`;
      
      setMessages(prev => [...prev, {
        sender: 'assistant',
        content: `Setting up project with command:\n\`\`\`\n${initCommand}\n\`\`\``,
        type: 'command'
      }]);
      
      // Execute the initialization command and wait for completion
      const initSuccess = await executeNonInteractiveViteCommand(initCommand);
      if (!initSuccess) {
        throw new Error("Project initialization failed");
      }
      
      // Wait a moment for the filesystem to update
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Step 3: Read the project structure
      const projectStructure = await getDirectoryStructure();
      
      // Step 4: Install additional dependencies if needed
      setWorkflowState('dependencies');
      if (projectPlan.dependencies.length > 0) {
        const additionalDeps = projectPlan.dependencies.filter(
          dep => dep !== 'react' && dep !== 'react-dom'
        );
        
        if (additionalDeps.length > 0) {
          const depInstallCommand = `npm install ${additionalDeps.join(' ')}`;
          
          setMessages(prev => [...prev, {
            sender: 'assistant',
            content: `Installing additional dependencies with command:\n\`\`\`\n${depInstallCommand}\n\`\`\``,
            type: 'command'
          }]);
          
          // Execute the dependency installation command
          const depSuccess = await executeCommand(depInstallCommand);
          if (!depSuccess) {
            console.warn("Additional dependencies installation had issues, continuing with project setup");
          }
          
          // Wait a moment for dependencies to install
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
      
      // Step 5: Generate code based on the updated project structure
      setWorkflowState('code_generation');
      setMessages(prev => [...prev, {
        sender: 'assistant',
        content: `Now generating code for your ${projectName} project based on the current structure...`,
        type: 'text'
      }]);
      
      // Read the directory structure again after dependency installation
      const updatedDirectoryStructure = await getDirectoryStructure();
      
      // Call the code generation endpoint with directory structure
      const codeGenContext = {
        userRequest: message,
        projectPlan: projectPlan,
        currentState: "generating code files",
        directoryStructure: updatedDirectoryStructure
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
          
          // Step 6: Start the development server
          setMessages(prev => [...prev, {
            sender: 'assistant',
            content: `Starting the development server with:\n\`\`\`\nnpm run dev\n\`\`\``,
            type: 'command'
          }]);
          
          // Execute the dev command
          if (onRunCommand) {
            await onRunCommand('npm run dev');
          }
          
          // Step 7: Workflow complete
          setWorkflowState('complete');
        } else {
          throw new Error('Invalid code generation result');
        }
      } catch (error) {
        console.error('Error processing code generation:', error);
        throw new Error(`Failed to generate valid code: ${error.message}`);
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