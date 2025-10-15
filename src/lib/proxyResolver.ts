/**
 * Resolves the CSM Proxy base URL
 * CRITICAL: VITE_PROXY_URL must be set at build time for production Docker builds
 */
export function resolveCsmProxyBase(): string {
  const proxyUrl = import.meta.env.VITE_PROXY_URL as string | undefined;
  
  if (!proxyUrl) {
    const isDev = import.meta.env.DEV;
    if (isDev) {
      // Development: use local proxy
      return 'http://localhost:3000/csm-proxy';
    } else {
      // Production without VITE_PROXY_URL: CRITICAL ERROR
      throw new Error(
        'CRITICAL: VITE_PROXY_URL not set at build time!\n\n' +
        'The application was built without specifying the proxy URL.\n' +
        'Please rebuild with: docker-compose build --no-cache\n\n' +
        'Ensure .env contains: VITE_PROXY_URL=http://localhost:3000/csm-proxy'
      );
    }
  }
  
  // Normalize to /csm-proxy endpoint
  return proxyUrl.replace(/\/csm-proxy\/?$/, '') + '/csm-proxy';
}

/**
 * Returns the login endpoint URL
 */
export function resolveLoginUrl(): string {
  const base = resolveCsmProxyBase();
  // csm-proxy handles login via action parameter
  return base;
}
