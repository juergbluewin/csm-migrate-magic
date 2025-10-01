import axios from 'axios';
import { networkLogger } from './networkLogger';

function previewText(input: string, max = 8000) {
  try {
    return input.length > max ? input.slice(0, max) + `\n… (truncated, total ${input.length} chars)` : input;
  } catch {
    return input;
  }
}

export function initNetworkLogging() {
  // fetch interceptor
  if (typeof window !== 'undefined' && !(window as any).__fetchPatched) {
    const originalFetch = window.fetch;
    (window as any).__fetchPatched = true;

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const id = Math.random().toString(36).slice(2, 10);
      const started = performance.now();
      const method = (init?.method || 'GET').toUpperCase();
      const url = typeof input === 'string' ? input : (input as URL).toString();

      let reqBodyPreview: string | undefined;
      try {
        if (init?.body && typeof init.body === 'string') reqBodyPreview = previewText(init.body);
      } catch {}

      try {
        const res = await originalFetch(input as any, init as any);
        const durationMs = Math.round(performance.now() - started);
        let respClone: Response | null = null;
        let respText: string | undefined;
        try {
          respClone = res.clone();
          respText = await respClone.text();
        } catch {}

        const headersObj: Record<string, string> = {};
        try {
          res.headers.forEach((v, k) => (headersObj[k] = v));
        } catch {}

        networkLogger.push({
          id,
          timestamp: Date.now(),
          method,
          url,
          status: res.status,
          ok: res.ok,
          durationMs,
          requestHeaders: (init?.headers as Record<string, string>) || undefined,
          requestBodyPreview: reqBodyPreview,
          responseHeaders: headersObj,
          responseBodyPreview: respText ? previewText(respText) : undefined,
          source: 'fetch',
        });

        return res;
      } catch (err: any) {
        const durationMs = Math.round(performance.now() - started);
        networkLogger.push({
          id,
          timestamp: Date.now(),
          method,
          url,
          durationMs,
          error: err?.message || String(err),
          requestHeaders: (init?.headers as Record<string, string>) || undefined,
          requestBodyPreview: reqBodyPreview,
          source: 'fetch',
        });
        throw err;
      }
    };
  }

  // axios interceptor (in case axios is used client-side)
  if ((axios as any).__networkIntercepted) return;
  (axios as any).__networkIntercepted = true;

  axios.interceptors.request.use((config) => {
    (config as any).__nl_id = Math.random().toString(36).slice(2, 10);
    (config as any).__nl_started = performance.now();
    return config;
  });

  axios.interceptors.response.use(
    (response) => {
      const id = (response.config as any).__nl_id || Math.random().toString(36).slice(2, 10);
      const started = (response.config as any).__nl_started || performance.now();
      const durationMs = Math.round(performance.now() - started);
      let requestBodyPreview: string | undefined;
      try {
        if (response.config.data && typeof response.config.data === 'string') requestBodyPreview = previewText(response.config.data);
      } catch {}

      networkLogger.push({
        id,
        timestamp: Date.now(),
        method: (response.config.method || 'GET').toUpperCase(),
        url: response.config.url || '',
        status: response.status,
        ok: response.status >= 200 && response.status < 300,
        durationMs,
        requestHeaders: (response.config.headers as Record<string, string>) || undefined,
        requestBodyPreview,
        responseHeaders: response.headers as Record<string, string>,
        responseBodyPreview: typeof response.data === 'string' ? previewText(response.data) : undefined,
        source: 'axios',
      });

      return response;
    },
    (error) => {
      try {
        const cfg = error.config || {};
        const id = (cfg as any).__nl_id || Math.random().toString(36).slice(2, 10);
        const started = (cfg as any).__nl_started || performance.now();
        const durationMs = Math.round(performance.now() - started);
        let requestBodyPreview: string | undefined;
        if (cfg.data && typeof cfg.data === 'string') requestBodyPreview = previewText(cfg.data);

        networkLogger.push({
          id,
          timestamp: Date.now(),
          method: (cfg.method || 'GET').toUpperCase(),
          url: cfg.url || '',
          status: error.response?.status,
          ok: false,
          durationMs,
          requestHeaders: (cfg.headers as Record<string, string>) || undefined,
          requestBodyPreview,
          responseHeaders: (error.response?.headers || {}) as Record<string, string>,
          responseBodyPreview: typeof error.response?.data === 'string' ? previewText(error.response.data) : undefined,
          error: error.message,
          source: 'axios',
        });
      } catch {}
      return Promise.reject(error);
    }
  );
}

// Do NOT auto-init here - let main.tsx call it explicitly after React is ready
