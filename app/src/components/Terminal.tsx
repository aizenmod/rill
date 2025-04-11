import React, { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import './Terminal.css';
import { webcontainerService } from '../services';
import { WebContainer } from '@webcontainer/api';

// Define exported ref methods interface
export interface TerminalRef {
  executeCommand: (cmd: string) => Promise<boolean>;
  getTerminal: () => XTerm | null;
}

interface TerminalProps {
  command?: string;
  onComplete?: () => void;
  initialOutput?: string;
  webcontainer?: WebContainer | null;
  onCommand?: (command: string) => void;
  onCommandOutput?: (output: string) => void;
  onCommandComplete?: (command: string, success: boolean) => void;
}

const Terminal = forwardRef<TerminalRef, TerminalProps>(({
  command,
  onComplete,
  initialOutput = '',
  webcontainer,
  onCommand,
  onCommandOutput,
  onCommandComplete,
}, ref) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const shellProcessRef = useRef<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const commandExecutingRef = useRef<string | null>(null);
  const outputBufferRef = useRef<string>('');
  const promptDetectedRef = useRef<boolean>(false);
  const commandQueueRef = useRef<string[]>([]);
  const isProcessingCommandRef = useRef<boolean>(false);
  const writerRef = useRef<WritableStreamDefaultWriter<any> | null>(null);

  // Process the command queue
  const processCommandQueue = async () => {
    if (isProcessingCommandRef.current || commandQueueRef.current.length === 0) {
      return;
    }

    isProcessingCommandRef.current = true;
    
    try {
      const cmd = commandQueueRef.current[0];
      
      if (!xtermRef.current || !shellProcessRef.current) {
        throw new Error('Terminal or shell not initialized');
      }

      // Set currently executing command
      commandExecutingRef.current = cmd;
      promptDetectedRef.current = false;
      
      // Write command to shell input using our safe method
      const success = await writeToShellInput(`${cmd}\n`);
      
      if (!success) {
        throw new Error('Failed to write command to shell');
      }
      
      // Let parent component know about command
      if (onCommand) {
        onCommand(cmd);
      }
      
      // Remove the command from the queue after a delay to ensure it's complete
      setTimeout(() => {
        commandQueueRef.current.shift();
        isProcessingCommandRef.current = false;
        
        // Process next command if there are any
        if (commandQueueRef.current.length > 0) {
          processCommandQueue();
        }
        
        setIsLoading(false);
        if (onComplete) {
          onComplete();
        }
      }, 2000);
    } catch (err) {
      console.error('Error processing command queue:', err);
      commandQueueRef.current.shift();
      isProcessingCommandRef.current = false;
      setIsLoading(false);
      setError(`Error executing command: ${err instanceof Error ? err.message : String(err)}`);
      commandExecutingRef.current = null;
      
      // Process next command if there are any
      if (commandQueueRef.current.length > 0) {
        setTimeout(() => {
          processCommandQueue();
        }, 1000);
      }
    }
  };

  // Expose methods via ref
  useImperativeHandle(ref, () => ({
    executeCommand: (cmd: string) => {
      return new Promise<boolean>((resolve) => {
        if (executeCommand(cmd)) {
          // Create a listener for command completion
          const checkOutput = (output: string) => {
            // If we detect a shell prompt after our command started
            if (promptDetectedRef.current && commandExecutingRef.current === cmd) {
              resolve(true);
              commandExecutingRef.current = null;
              promptDetectedRef.current = false;
            }
          };
          
          // Set up a one-time listener
          const listener = (event: CustomEvent) => {
            checkOutput(event.detail?.output || '');
            if (!commandExecutingRef.current) {
              window.removeEventListener('terminal-output' as any, listener);
            }
          };
          
          window.addEventListener('terminal-output' as any, listener);
          
          // Fallback timeout in case prompt detection fails
          setTimeout(() => {
            if (commandExecutingRef.current === cmd) {
              resolve(true);
              commandExecutingRef.current = null;
              window.removeEventListener('terminal-output' as any, listener);
            }
          }, 10000); // 10 second timeout
        } else {
          resolve(false);
        }
      });
    },
    getTerminal: () => xtermRef.current
  }));

  // Initialize terminal and shell
  useEffect(() => {
    if (!terminalRef.current) return;

    const initTerminal = async () => {
      // Initialize xterm.js
      const terminal = new XTerm({
        cursorBlink: true,
        theme: {
          background: '#1e1e1e',
          foreground: '#f0f0f0',
          cursor: '#f0f0f0',
          cursorAccent: '#1e1e1e',
        },
        scrollback: 1000,
        fontSize: 14,
        convertEol: true,
      });

      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      
      if (terminalRef.current) {
        terminal.open(terminalRef.current);
        fitAddon.fit();
      }

      xtermRef.current = terminal;
      fitAddonRef.current = fitAddon;

      // Write initial output if provided
      if (initialOutput) {
        terminal.write(initialOutput);
      } else {
        // Show a welcome message
        terminal.write('WebContainer Terminal Ready\r\n$ ');
      }

      try {
        // Start shell in the WebContainer
        const shellProcess = await startShell(terminal);
        shellProcessRef.current = shellProcess;

        // Set up terminal input handler - use our safe write method
        terminal.onData((data) => {
          writeToShellInput(data);
        });

        // If a command is provided, execute it
        if (command) {
          // Add a small delay to ensure shell is ready
          setTimeout(() => {
            executeCommand(command);
          }, 1000);
        }
      } catch (err) {
        console.error('Failed to start shell:', err);
        setError(`Failed to start shell: ${err instanceof Error ? err.message : String(err)}`);
      }
    };

    // Only initialize if webcontainer exists
    const getWebContainer = async () => {
      let container = webcontainer;
      
      if (!container) {
        try {
          // Try to get from service
          container = await webcontainerService.getInstance();
          
          // If still not available, wait for webcontainer-ready event
          if (!container) {
            return new Promise<void>((resolve) => {
              const handleWebcontainerReady = (event: Event) => {
                window.removeEventListener('webcontainer-ready', handleWebcontainerReady);
                resolve();
              };
              
              window.addEventListener('webcontainer-ready', handleWebcontainerReady);
              
              // Timeout after 10 seconds
              setTimeout(() => {
                window.removeEventListener('webcontainer-ready', handleWebcontainerReady);
                resolve();
              }, 10000);
            });
          }
        } catch (error) {
          console.error('Error getting WebContainer:', error);
          return;
        }
      }
      
      // Now initialize terminal
      await initTerminal();
    };
    
    getWebContainer();

    return () => {
      if (xtermRef.current) {
        xtermRef.current.dispose();
      }
    };
  }, [webcontainer, initialOutput, command]);

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      if (fitAddonRef.current && shellProcessRef.current) {
        fitAddonRef.current.fit();
        shellProcessRef.current.resize({
          cols: xtermRef.current?.cols,
          rows: xtermRef.current?.rows,
        });
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Process terminal output to detect command completion and interactive prompts
  const processOutput = (data: string) => {
    // Append to buffer
    outputBufferRef.current += data;
    
    // Notify of output
    if (onCommandOutput) {
      onCommandOutput(data);
    }
    
    // Dispatch terminal output event
    window.dispatchEvent(new CustomEvent('terminal-output', { 
      detail: { output: data, fullBuffer: outputBufferRef.current } 
    }));
    
    // Check for interactive prompts that require user input
    const promptsToAutoRespond = [
      { pattern: /Ok to proceed\? \(y\)/, response: 'y\n' },
      { pattern: /\? Choose a variant:/, response: '\n' }, // Just press enter for default
      { pattern: /\? Select a framework:/, response: '\n' }, // Just press enter for default
      { pattern: /\? Package name:/, response: '\n' }, // Accept default name
      { pattern: /\? Would you like to install dependencies.*\(Y\/n\)/, response: 'Y\n' },
      { pattern: /\? Would you like to run `npm run dev`.*\(Y\/n\)/, response: 'Y\n' },
      { pattern: /password.*:/, response: '\n' }, // Skip password prompts with enter
      { pattern: /Do you want to continue\? \(y\/n\)/, response: 'y\n' },
    ];
    
    // Check for any interactive prompts
    for (const { pattern, response } of promptsToAutoRespond) {
      if (pattern.test(outputBufferRef.current)) {
        console.log(`Detected interactive prompt: ${pattern}`);
        
        // Auto-respond after a short delay to make it feel more natural
        setTimeout(() => {
          if (shellProcessRef.current) {
            try {
              // Use our safe write method
              writeToShellInput(response);
              console.log(`Auto-responded with: ${response.trim()}`);
            } catch (error) {
              console.error('Error auto-responding to prompt:', error);
            }
          }
        }, 500);
        
        // Clear this pattern from the buffer to avoid responding multiple times
        outputBufferRef.current = outputBufferRef.current.replace(pattern, '');
        break;
      }
    }
    
    // Check for shell prompt pattern ($ or > at end of line)
    const promptPattern = /[\r\n][^$>]*[$>]\s*$/;
    if (promptPattern.test(outputBufferRef.current)) {
      promptDetectedRef.current = true;
      
      // If we have an executing command and detect prompt, it's complete
      if (commandExecutingRef.current && onCommandComplete) {
        onCommandComplete(commandExecutingRef.current, true);
        commandExecutingRef.current = null;
      }
      
      // Clear buffer after prompt
      outputBufferRef.current = '';
    }
  };

  // Start shell in WebContainer
  const startShell = async (terminal: XTerm) => {
    setIsLoading(true);
    try {
      // Get WebContainer instance from props or service
      const webcontainerInstance = webcontainer || await webcontainerService.getInstance();
      
      if (!webcontainerInstance) {
        throw new Error('WebContainer instance not available');
      }
      
      // Spawn shell process
      const shellProcess = await webcontainerInstance.spawn('jsh', {
        terminal: {
          cols: terminal.cols,
          rows: terminal.rows,
        },
      });
      
      // Pipe shell output to terminal
      shellProcess.output.pipeTo(
        new WritableStream({
          write(data) {
            terminal.write(data);
            // Process output for command completion detection
            const dataString = typeof data === 'string' ? data : String(data);
            processOutput(dataString);
            
            // Extract command from output if onCommand is provided
            if (onCommand && dataString.includes('\n')) {
              onCommand(dataString);
            }
          },
        })
      );
      
      // Store the shell process but don't get a writer here
      // We'll handle all input through a controlled approach
      setIsLoading(false);
      return shellProcess;
    } catch (err) {
      setIsLoading(false);
      setError(`Error starting shell: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  };

  // Safe way to write to shell input
  const writeToShellInput = async (text: string): Promise<boolean> => {
    if (!shellProcessRef.current) {
      return false;
    }

    try {
      // Create a new writer for each write operation to avoid lock issues
      const writer = shellProcessRef.current.input.getWriter();
      
      try {
        await writer.write(text);
        return true;
      } finally {
        // Always release the writer when done, even if there was an error
        writer.releaseLock();
      }
    } catch (error) {
      console.error('Error writing to shell input:', error);
      return false;
    }
  };

  // Execute command in terminal
  const executeCommand = (cmd: string): boolean => {
    if (!xtermRef.current || !shellProcessRef.current) {
      setError('Terminal or shell not initialized');
      return false;
    }
    
    setIsLoading(true);
    
    try {
      // Add command to queue
      commandQueueRef.current.push(cmd);
      
      // Process the queue if not already processing
      if (!isProcessingCommandRef.current) {
        processCommandQueue();
      }
      
      return true;
    } catch (err) {
      setIsLoading(false);
      setError(`Error executing command: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  };

  return (
    <div className="terminal-container">
      {isLoading && (
        <div className="terminal-loading">
          <div className="typing-indicator">
            <span></span>
            <span></span>
            <span></span>
          </div>
        </div>
      )}
      <div 
        ref={terminalRef} 
        className="terminal"
      />
      {error && <div className="terminal-error">{error}</div>}
    </div>
  );
});

export default Terminal; 