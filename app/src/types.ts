import { WebContainer } from '@webcontainer/api';

export interface FileSelectedEvent extends CustomEvent {
  detail: {
    path: string;
    content: string;
  };
}

// Extend Window interface to include cross-origin isolation property
declare global {
  interface Window {
    crossOriginIsolated?: boolean;
  }
} 