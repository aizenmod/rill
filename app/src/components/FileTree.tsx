import React, { useState, useEffect } from 'react';
import { webcontainerService } from '../services';
import type { DirectoryTreeValue } from '../services';
import './FileTree.css';

type FileNode = {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileNode[];
};

export const FileTree: React.FC<{
  onFileSelect: (path: string) => void;
}> = ({ onFileSelect }) => {
  const [files, setFiles] = useState<FileNode[]>([]);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [webcontainerReady, setWebcontainerReady] = useState(false);

  // Helper function to determine file icon based on extension
  const getFileIconClass = (fileName: string): string => {
    if (fileName.endsWith('.js')) return 'file-icon js-icon';
    if (fileName.endsWith('.jsx')) return 'file-icon jsx-icon';
    if (fileName.endsWith('.ts')) return 'file-icon ts-icon';
    if (fileName.endsWith('.tsx')) return 'file-icon tsx-icon';
    if (fileName.endsWith('.html')) return 'file-icon html-icon';
    if (fileName.endsWith('.css')) return 'file-icon css-icon';
    if (fileName.endsWith('.json')) return 'file-icon json-icon';
    if (fileName.endsWith('.md')) return 'file-icon md-icon';
    if (fileName === 'package.json') return 'file-icon package-icon';
    if (fileName === '.gitignore') return 'file-icon git-icon';
    // Default icon for other file types
    return 'file-icon default-icon';
  };

  // Convert flat directory tree to hierarchical structure
  const buildFileTree = (directoryTree: DirectoryTreeValue, basePath: string = ''): FileNode[] => {
    return Object.entries(directoryTree)
      .map(([name, value]) => {
        const path = basePath ? `${basePath}/${name}` : name;
        const isDirectory = typeof value === 'object';
        
        return {
          name,
          path,
          isDirectory,
          ...(isDirectory && { children: buildFileTree(value as DirectoryTreeValue, path) })
        };
      })
      .sort((a, b) => {
        // Sort directories first, then files alphabetically
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
      });
  };

  // Load file tree function that can be called multiple times
  const loadFileTree = async () => {
    setIsLoading(true);
    try {
      const webcontainer = webcontainerService.getInstance();
      if (!webcontainer) {
        throw new Error('WebContainer not initialized');
      }
      
      const directoryTree = await webcontainerService.getDirectoryTree();
      const fileTree = buildFileTree(directoryTree);
      setFiles(fileTree);
      
      // Auto-expand the root level directories
      const rootDirs = new Set<string>();
      fileTree.forEach(node => {
        if (node.isDirectory) {
          rootDirs.add(node.path);
        }
      });
      setExpandedFolders(rootDirs);
    } catch (error) {
      console.error('Failed to load file tree:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Listen for WebContainer ready event
  useEffect(() => {
    const handleWebContainerReady = () => {
      console.log('WebContainer is ready in FileTree component');
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

  // Fetch directory tree when WebContainer is ready
  useEffect(() => {
    if (webcontainerReady) {
      loadFileTree();
      
      // Listen for file system changes
      const webcontainer = webcontainerService.getInstance();
      if (webcontainer) {
        const unsubscribe = webcontainer.on('server-ready', () => {
          loadFileTree();
        });

        return () => {
          unsubscribe();
        };
      }
    }
  }, [webcontainerReady]);

  // Listen for terminal command execution events
  useEffect(() => {
    const handleTerminalCommand = () => {
      loadFileTree();
    };

    window.addEventListener('terminal-command-executed', handleTerminalCommand);

    return () => {
      window.removeEventListener('terminal-command-executed', handleTerminalCommand);
    };
  }, []);

  const handleFileClick = (node: FileNode) => {
    if (node.isDirectory) {
      // Toggle folder expansion
      setExpandedFolders(prev => {
        const newSet = new Set(prev);
        if (newSet.has(node.path)) {
          newSet.delete(node.path);
        } else {
          newSet.add(node.path);
        }
        return newSet;
      });
    } else {
      // Select file
      setSelectedFilePath(node.path);
      onFileSelect(node.path);
    }
  };

  const renderFileNode = (node: FileNode, level: number = 0) => {
    const isExpanded = expandedFolders.has(node.path);
    const isSelected = selectedFilePath === node.path;

    return (
      <div key={node.path} style={{ marginLeft: `${level * 12}px` }}>
        <div 
          className={`file-node ${isSelected ? 'selected' : ''}`}
          onClick={() => handleFileClick(node)}
        >
          {node.isDirectory ? (
            <span className={`folder-icon ${isExpanded ? 'expanded' : 'collapsed'}`}></span>
          ) : (
            <span className={getFileIconClass(node.name)}></span>
          )}
          <span className="file-name">{node.name}</span>
        </div>
        
        {node.isDirectory && isExpanded && node.children && (
          <div className="file-children">
            {node.children.map(child => renderFileNode(child, level + 1))}
          </div>
        )}
      </div>
    );
  };

  if (isLoading) {
    return <div className="file-tree-container loading">Loading files...</div>;
  }

  return (
    <div className="file-tree-container">
      <div className="file-tree-header">EXPLORER</div>
      <div className="file-tree">
        {files.map(file => renderFileNode(file))}
      </div>
    </div>
  );
}; 