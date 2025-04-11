import React, { useEffect, useRef, useState } from 'react';
import { FileSelectedEvent } from '../types';
import Editor from '@monaco-editor/react';
import { webcontainerService } from '../services';

interface EditorProps {
  currentFile: string;
  onFileChange: (content: string) => void;
}

const CodeEditor: React.FC<EditorProps> = ({ currentFile, onFileChange }) => {
  const [content, setContent] = useState<string>('');
  const editorRef = useRef<any>(null);
  
  // Handle editor mount
  const handleEditorDidMount = (editor: any) => {
    editorRef.current = editor;
  };
  
  // Update editor content when currentFile changes
  useEffect(() => {
    const loadFileContent = async () => {
      if (!currentFile) return;
      
      try {
        const fileContent = await webcontainerService.readFile(currentFile);
        setContent(fileContent);
      } catch (error) {
        console.error(`Error loading file: ${currentFile}`, error);
      }
    };
    
    loadFileContent();
  }, [currentFile]);
  
  // Listen for file-selected events
  useEffect(() => {
    const handleFileSelected = (e: FileSelectedEvent) => {
      const { path, content } = e.detail;
      
      if (path === currentFile) {
        setContent(content);
      }
    };
    
    document.addEventListener('file-selected', handleFileSelected as EventListener);
    
    return () => {
      document.removeEventListener('file-selected', handleFileSelected as EventListener);
    };
  }, [currentFile]);
  
  // Determine language based on file extension
  const getLanguageFromPath = (path: string): string => {
    const extension = path.split('.').pop()?.toLowerCase() || '';
    
    // Map common file extensions to Monaco language IDs
    const languageMap: Record<string, string> = {
      js: 'javascript',
      jsx: 'javascript',
      ts: 'typescript',
      tsx: 'typescript',
      html: 'html',
      css: 'css',
      json: 'json',
      md: 'markdown',
      py: 'python',
      sh: 'shell',
    };
    
    return languageMap[extension] || 'plaintext';
  };
  
  const handleEditorChange = (value: string | undefined) => {
    if (value !== undefined) {
      onFileChange(value);
    }
  };
  
  return (
    <div className="editor">
      <div className="editor-header">
        <span className="current-file">{currentFile}</span>
      </div>
      <Editor
        height="100%"
        defaultLanguage={getLanguageFromPath(currentFile)}
        language={getLanguageFromPath(currentFile)}
        theme="vs-dark"
        value={content}
        onChange={handleEditorChange}
        onMount={handleEditorDidMount}
        options={{
          minimap: { enabled: true },
          scrollBeyondLastLine: false,
          fontSize: 14,
          tabSize: 2,
          automaticLayout: true,
        }}
      />
    </div>
  );
};

export default CodeEditor; 