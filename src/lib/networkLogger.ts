export type NetworkLogEntry = {
  id: string;
  timestamp: number;
  method: string;
  url: string;
  status?: number;
  ok?: boolean;
  durationMs?: number;
  requestHeaders?: Record<string, string>;
  requestBodyPreview?: string;
  responseHeaders?: Record<string, string>;
  responseBodyPreview?: string;
  error?: string;
  source: 'fetch' | 'axios';
};

export type NetworkLoggerState = {
  entries: NetworkLogEntry[];
  enabled: boolean;
};

export type NetworkLoggerListener = (state: NetworkLoggerState) => void;

class NetworkLogger {
  private state: NetworkLoggerState = { entries: [], enabled: true };
  private listeners: Set<NetworkLoggerListener> = new Set();

  subscribe(listener: NetworkLoggerListener) {
    this.listeners.add(listener);
    // emit current state immediately
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  enable(v: boolean) {
    this.state.enabled = v;
    this.emit();
  }

  clear() {
    this.state.entries = [];
    this.emit();
  }

  push(entry: NetworkLogEntry) {
    if (!this.state.enabled) return;
    // Cap log size to avoid memory bloat
    this.state.entries = [entry, ...this.state.entries].slice(0, 300);
    this.emit();
  }

  private emit() {
    for (const l of this.listeners) l(this.state);
  }
}

export const networkLogger = new NetworkLogger();

// Expose in dev for quick access
// @ts-ignore
if (typeof window !== 'undefined') (window as any).__networkLogger = networkLogger;
