import React, { useEffect, useRef, useState } from 'react';
import { webcontainerService } from '../services';

const Preview: React.FC = () => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [serverUrl, setServerUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [webcontainerReady, setWebcontainerReady] = useState(false);

  // Helper function to read output from a stream
  const readStreamOutput = async (stream: ReadableStream<string>): Promise<string> => {
    const reader = stream.getReader();
    let result = '';
    
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        result += value;
      }
      return result;
    } finally {
      reader.releaseLock();
    }
  };

  // Check for running server and update iframe
  const checkForRunningServer = async () => {
    try {
      const webcontainer = webcontainerService.getInstance();
      if (!webcontainer) return;

      // Try to detect if a server is running by checking common ports
      // Port 3000 is commonly used by dev servers
      const ports = [3000, 3001, 3111, 8000, 8080, 9000];
      
      for (const port of ports) {
        try {
          // This is a non-blocking way to check if a port is being used
          const checkProcess = await webcontainer.spawn('lsof', ['-i', `:${port}`]);
          const output = await readStreamOutput(checkProcess.output);
          
          if (output && output.includes(`*:${port}`)) {
            const url = `http://localhost:${port}`;
            console.log(`Detected server running on ${url}`);
            
            // Update the iframe with the detected URL
            setServerUrl(url);
            setLoading(false);
            if (iframeRef.current) {
              iframeRef.current.src = url;
            }
            return;
          }
        } catch {
          // Command might fail if lsof is not available, try another method
          try {
            // Alternative approach - try netstat
            const netstatProcess = await webcontainer.spawn('netstat', ['-tunlp']);
            const output = await readStreamOutput(netstatProcess.output);
            
            if (output && output.includes(`:${port}`)) {
              const url = `http://localhost:${port}`;
              console.log(`Detected server running on ${url} using netstat`);
              
              setServerUrl(url);
              setLoading(false);
              if (iframeRef.current) {
                iframeRef.current.src = url;
              }
              return;
            }
          } catch {
            // Both methods failed for this port, continue checking others
          }
        }
      }
      
      // If we couldn't detect a server through network utils, look for log messages
      try {
        const grepProcess = await webcontainer.spawn('grep', ['-r', 'listen.*port', '/tmp']);
        const output = await readStreamOutput(grepProcess.output);
        
        // Example: App is live at http://localhost:3111
        const urlMatch = output.match(/https?:\/\/localhost:(\d+)/);
        if (urlMatch && urlMatch[0]) {
          console.log(`Found server URL in logs: ${urlMatch[0]}`);
          setServerUrl(urlMatch[0]);
          setLoading(false);
          if (iframeRef.current) {
            iframeRef.current.src = urlMatch[0];
          }
        }
      } catch {
        // Grep command failed, continue with other methods
      }
    } catch (error) {
      console.error('Error checking for running server:', error);
    }
  };

  useEffect(() => {
    const init = async () => {
      try {
        setLoading(true);
        setError(null);
        
        // Instead of booting WebContainer, use the instance from App.tsx
        const webcontainer = webcontainerService.getInstance();
        
        if (!webcontainer) {
          throw new Error('WebContainer not initialized');
        }

        // Handler for server-ready event
        const serverReadyHandler = (port: number, url: string) => {
          console.log(`Server ready on port ${port} at ${url}`);
          setServerUrl(url);
          setLoading(false);
          if (iframeRef.current) {
            iframeRef.current.src = url;
          }
        };

        // Register the event handler
        const unsubscribe = webcontainer.on('server-ready', serverReadyHandler);

        // Check if a server is already running
        await checkForRunningServer();

        return () => {
          unsubscribe();
        };
      } catch (error) {
        console.error('Error initializing preview:', error);
        setError(error instanceof Error ? error.message : 'Failed to initialize preview');
        setLoading(false);
      }
    };

    // Only initialize when WebContainer is ready
    if (webcontainerReady) {
      init();
    }
  }, [webcontainerReady]);

  // Listen for webcontainer-ready event from App.tsx
  useEffect(() => {
    const handleWebContainerReady = () => {
      console.log('WebContainer is ready in Preview component');
      setWebcontainerReady(true);
    };

    // Check if WebContainer is already initialized
    if (webcontainerService.getInstance()) {
      setWebcontainerReady(true);
    } else {
      // Listen for the event if not already initialized
      window.addEventListener('webcontainer-ready', handleWebContainerReady);
    }

    return () => {
      window.removeEventListener('webcontainer-ready', handleWebContainerReady);
    };
  }, []);

  // Listen for terminal command execution events
  useEffect(() => {
    const handleTerminalCommand = () => {
      console.log('Terminal command executed, checking for server...');
      
      // Wait a moment to allow the server to start before checking
      setTimeout(() => {
        checkForRunningServer();
      }, 1000);
    };

    window.addEventListener('terminal-command-executed', handleTerminalCommand);

    return () => {
      window.removeEventListener('terminal-command-executed', handleTerminalCommand);
    };
  }, []);

  return (
    <div className="preview">
      {loading && <div className="preview-placeholder">Initializing preview environment...</div>}
      {error && <div className="preview-placeholder">Error: {error}</div>}
      {!loading && !error && !serverUrl && <div className="preview-placeholder">Waiting for server to start...<br/><small>Try running 'npm start' in the terminal</small></div>}
      <iframe ref={iframeRef} title="Application Preview"></iframe>
    </div>
  );
};

export default Preview; 