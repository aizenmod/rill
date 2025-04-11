import { WebContainer } from '@webcontainer/api';
import { files } from '../files';

// Define a type for the directory tree structure
export interface DirectoryTreeValue {
  [key: string]: DirectoryTreeValue | boolean;
}

/**
 * Service to handle WebContainer operations
 */
export class WebContainerService {
  private webcontainer: WebContainer | null = null;

  /**
   * Initialize the WebContainer instance
   */
  async boot(): Promise<WebContainer> {
    if (this.webcontainer) {
      return this.webcontainer;
    }

    try {
      this.webcontainer = await WebContainer.boot();
      await this.webcontainer.mount(files);
      return this.webcontainer;
    } catch (error) {
      console.error('Error booting WebContainer:', error);
      throw error;
    }
  }

  /**
   * Get the WebContainer instance
   */
  getInstance(): WebContainer | null {
    return this.webcontainer;
  }

  /**
   * Write content to a file
   */
  async writeFile(path: string, content: string): Promise<void> {
    if (!this.webcontainer) {
      throw new Error('WebContainer not initialized');
    }

    try {
      // Normalize the path to remove leading slash for WebContainer
      const normalizedPath = path.startsWith('/') ? path.slice(1) : path;
      await this.webcontainer.fs.writeFile(normalizedPath, content);
    } catch (error) {
      console.error(`Error writing file: ${path}`, error);
      throw error;
    }
  }

  /**
   * Read content from a file
   */
  async readFile(path: string): Promise<string> {
    if (!this.webcontainer) {
      throw new Error('WebContainer not initialized');
    }

    try {
      // Normalize the path to remove leading slash for WebContainer
      const normalizedPath = path.startsWith('/') ? path.slice(1) : path;
      return await this.webcontainer.fs.readFile(normalizedPath, 'utf-8');
    } catch (error) {
      console.error(`Error reading file: ${path}`, error);
      throw error;
    }
  }

  /**
   * Create a directory and any parent directories if they don't exist
   */
  async createDirectory(path: string): Promise<void> {
    if (!this.webcontainer) {
      throw new Error('WebContainer not initialized');
    }

    try {
      // Normalize the path to remove leading slash for WebContainer
      const normalizedPath = path.startsWith('/') ? path.slice(1) : path;
      await this.webcontainer.fs.mkdir(normalizedPath, { recursive: true });
    } catch (error) {
      console.error(`Error creating directory: ${path}`, error);
      throw error;
    }
  }

  /**
   * Get a directory tree structure
   */
  async getDirectoryTree(path: string = '/'): Promise<DirectoryTreeValue> {
    if (!this.webcontainer) {
      throw new Error('WebContainer not initialized');
    }

    try {
      // Normalize the path to remove leading slash for WebContainer
      const normalizedPath = path.startsWith('/') ? path.slice(1) : path;
      
      const directoryTree: DirectoryTreeValue = {};
      const entries = await this.webcontainer.fs.readdir(normalizedPath, { withFileTypes: true });
      
      for (const entry of entries) {
        const entryPath = normalizedPath ? `${normalizedPath}/${entry.name}` : entry.name;
        
        if (entry.isDirectory()) {
          directoryTree[entry.name] = await this.getDirectoryTree(entryPath);
        } else {
          directoryTree[entry.name] = true; // Use a simple value for files
        }
      }
      
      return directoryTree;
    } catch (error) {
      console.error(`Error getting directory tree: ${path}`, error);
      return {};
    }
  }
}

// Create a singleton instance
export const webcontainerService = new WebContainerService(); 