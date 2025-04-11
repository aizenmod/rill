import React, { useEffect, useState, useRef, useCallback } from 'react';
import { webcontainerService } from './services';
import { FileTree, Editor, Terminal, Preview, DebugPanel, ChatSidebar } from './components';
import { TerminalRef } from './components/Terminal';
import './App.css';

export default function App() {
  const [currentFile, setCurrentFile] = useState('/index.js');
  const [isWebContainerInitialized, setIsWebContainerInitialized] = useState(false);
  const [debugLog, setDebugLog] = useState<string[]>([]);
  const [showDebug, setShowDebug] = useState(false);
  
  // View control states
  const [activeView, setActiveView] = useState<'preview' | 'editor'>('editor');
  const [isTerminalVisible, setIsTerminalVisible] = useState(true);
  const [isTerminalCollapsed, setIsTerminalCollapsed] = useState(false);
  const [terminalHeight, setTerminalHeight] = useState(300);
  
  // Chat sidebar state
  const [isChatSidebarVisible, setIsChatSidebarVisible] = useState(false);
  
  // Refs for resize functionality
  const resizingRef = useRef(false);
  const startYRef = useRef(0);
  const startHeightRef = useRef(0);
  const terminalRef = useRef<HTMLDivElement>(null);
  
  // Terminal reference
  const terminalComponentRef = useRef<TerminalRef>(null);

  // Initialize WebContainer on mount
  useEffect(() => {
    if (isWebContainerInitialized) return;

    // Check if the page is cross-origin isolated
    if (!window.crossOriginIsolated) {
      console.warn('Cross-Origin Isolation is not enabled. WebContainer may not work properly.');
    }

    (async () => {
      try {
        const container = await webcontainerService.boot();
        
        // Wait a moment for the WebContainer to be fully ready
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Signal that WebContainer is ready
        setIsWebContainerInitialized(true);
        logDebug('WebContainer initialized successfully');
        
        // Dispatch an event that WebContainer is ready
        window.dispatchEvent(new CustomEvent('webcontainer-ready', { 
          detail: { webcontainer: container } 
        }));
      } catch (error) {
        console.error('Error initializing WebContainer:', error);
        logDebug(`Error initializing WebContainer: ${error}`);
      }
    })();
  }, [isWebContainerInitialized]);

  // Set up keyboard shortcuts
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // CMD+I (Mac) or CTRL+I (Windows) to toggle chat sidebar
    if ((e.metaKey || e.ctrlKey) && e.key === 'i') {
      e.preventDefault();
      setIsChatSidebarVisible(prev => !prev);
    }
  }, []);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown]);

  // Set up terminal resize handlers
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if ((e.target as HTMLElement).classList.contains('terminal-resize-handle')) {
        e.preventDefault();
        resizingRef.current = true;
        startYRef.current = e.clientY;
        startHeightRef.current = terminalHeight;
        document.body.style.cursor = 'ns-resize';
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!resizingRef.current) return;
      
      const delta = startYRef.current - e.clientY;
      const newHeight = Math.max(100, Math.min(800, startHeightRef.current + delta));
      setTerminalHeight(newHeight);
    };

    const handleMouseUp = () => {
      if (resizingRef.current) {
        resizingRef.current = false;
        document.body.style.cursor = '';
      }
    };

    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [terminalHeight]);

  /**
   * Log debug messages
   */
  const logDebug = (message: string) => {
    console.log(`[DEBUG] ${message}`);
    setDebugLog(prev => [...prev, `[${new Date().toISOString()}] ${message}`]);
  };

  /**
   * Handle file content changes
   */
  const handleFileChange = async (content: string) => {
    try {
      await webcontainerService.writeFile(currentFile, content);
      logDebug(`File saved: ${currentFile}`);
    } catch {
      logDebug(`Error saving file: ${currentFile}`);
    }
  };

  /**
   * Handle file selection from the file tree
   */
  const handleFileSelect = async (filepath: string) => {
    setCurrentFile(filepath);
    logDebug(`Selected file: ${filepath}`);
    // Switch to editor view when a file is selected
    setActiveView('editor');
  };

  /**
   * Handle terminal command execution
   */
  const handleTerminalCommand = (command: string) => {
    logDebug(`Terminal command executed: ${command}`);
    
    // Dispatch an event to notify other components that a terminal command was executed
    window.dispatchEvent(new CustomEvent('terminal-command-executed', { detail: { command } }));
  };

  /**
   * Execute a command in the terminal and wait for completion
   */
  const executeTerminalCommand = async (command: string): Promise<boolean> => {
    // Make sure WebContainer and terminal are ready
    if (!isWebContainerInitialized) {
      logDebug(`WebContainer not initialized. Cannot execute command: ${command}`);
      return false;
    }
    
    if (!terminalComponentRef.current) {
      logDebug(`Terminal not ready to execute command: ${command}`);
      return false;
    }
    
    try {
      logDebug(`Executing command in terminal: ${command}`);
      return await terminalComponentRef.current.executeCommand(command);
    } catch (error) {
      logDebug(`Error executing command: ${command} - ${error}`);
      return false;
    }
  };

  /**
   * Clear debug logs
   */
  const handleClearDebug = () => {
    setDebugLog([]);
  };

  /**
   * Toggle terminal visibility
   */
  const toggleTerminalVisibility = () => {
    setIsTerminalVisible(!isTerminalVisible);
  };

  /**
   * Toggle terminal collapse state
   */
  const toggleTerminalCollapse = () => {
    setIsTerminalCollapsed(!isTerminalCollapsed);
  };

  /**
   * Handle terminal header click (alternative way to collapse/expand)
   */
  const handleTerminalHeaderClick = () => {
    toggleTerminalCollapse();
  };

  /**
   * Toggle chat sidebar visibility
   */
  const toggleChatSidebar = () => {
    setIsChatSidebarVisible(!isChatSidebarVisible);
  };

  return (
    <div className="container">
      <div className="sidebar">
        <div className="sidebar-header">
          <span>Dual Editor</span>
          <div>
            <button 
              className="debug-button" 
              onClick={() => setShowDebug(!showDebug)}
            >
              {showDebug ? 'Hide Debug' : 'Debug'}
            </button>
          </div>
        </div>
        <div className="file-tree-wrapper">
          <FileTree onFileSelect={handleFileSelect} />
        </div>
        {showDebug && (
          <DebugPanel 
            logs={debugLog} 
            onClear={handleClearDebug} 
          />
        )}
      </div>
      <div className={`main-content ${isChatSidebarVisible ? 'chat-visible' : ''}`}>
        <div className="view-controls">
          <button 
            className={`view-button ${activeView === 'preview' ? 'active' : ''}`}
            onClick={() => setActiveView('preview')}
          >
            Preview
          </button>
          <button 
            className={`view-button ${activeView === 'editor' ? 'active' : ''}`}
            onClick={() => setActiveView('editor')}
          >
            Editor
          </button>
          <button 
            className={`terminal-toggle-button ${isTerminalVisible ? 'active' : ''}`}
            onClick={toggleTerminalVisibility}
          >
            {isTerminalVisible ? 'Hide Terminal' : 'Show Terminal'}
          </button>
          {isTerminalVisible && (
            <button 
              className="terminal-collapse-button"
              onClick={toggleTerminalCollapse}
            >
              {isTerminalCollapsed ? 'Expand' : 'Collapse'}
            </button>
          )}
          <button 
            className={`chat-toggle-button ${isChatSidebarVisible ? 'active' : ''}`}
            onClick={toggleChatSidebar}
          >
            AI Chat (⌘I)
          </button>
        </div>
        
        <div className={`content-area ${isTerminalVisible ? 'with-terminal' : ''} ${isTerminalCollapsed ? 'terminal-collapsed' : ''}`}>
          <div className={`main-view-container ${activeView === 'preview' ? 'active' : ''}`}>
            <Preview />
          </div>
          
          <div className={`main-view-container ${activeView === 'editor' ? 'active' : ''}`}>
            <Editor 
              currentFile={currentFile}
              onFileChange={handleFileChange}
            />
          </div>
          
          {isTerminalVisible && (
            <>
              <div className="terminal-resize-handle" title="Drag to resize terminal"></div>
              <div 
                className={`terminal-container ${isTerminalCollapsed ? 'collapsed' : ''}`}
                ref={terminalRef}
                style={{ height: isTerminalCollapsed ? '30px' : `${terminalHeight}px` }}
              >
                <div 
                  className="terminal-header"
                  onClick={handleTerminalHeaderClick}
                >
                  <span>Terminal</span>
                  <span className="terminal-collapse-icon">
                    {isTerminalCollapsed ? '▲' : '▼'}
                  </span>
                </div>
                {isWebContainerInitialized && (
                  <Terminal 
                    ref={terminalComponentRef}
                    webcontainer={webcontainerService.getInstance()}
                    onCommand={handleTerminalCommand}
                    onCommandComplete={(cmd, success) => {
                      logDebug(`Command completed: ${cmd} (success: ${success})`);
                    }}
                  />
                )}
              </div>
            </>
          )}
        </div>
      </div>
      
      <ChatSidebar 
        isVisible={isChatSidebarVisible}
        onClose={() => setIsChatSidebarVisible(false)}
        onRunCommand={executeTerminalCommand}
        onFileSelect={handleFileSelect}
      />
    </div>
  );
} 