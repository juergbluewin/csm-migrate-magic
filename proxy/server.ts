import express from 'express';
import cors from 'cors';
import http from 'node:http';
import https from 'node:https';
import axios from 'axios';
import { randomBytes } from 'crypto';

const app = express();
const PORT = process.env.PORT || 3000;

// Environment configuration
const CORS_ALLOW_ORIGIN = process.env.CORS_ALLOW_ORIGIN || '*';
const VERIFY_TLS = process.env.VERIFY_TLS !== 'false';
const CSM_BASEURL = process.env.CSM_BASEURL?.replace(/\/+$/, '');

console.log('🔧 Proxy Configuration:', {
  PORT,
  CORS_ALLOW_ORIGIN,
  VERIFY_TLS,
  CSM_BASEURL: CSM_BASEURL || 'auto-discovery',
});

// CORS Middleware
const corsOptions = {
  origin: CORS_ALLOW_ORIGIN === '*' ? '*' : CORS_ALLOW_ORIGIN,
  credentials: CORS_ALLOW_ORIGIN !== '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['Set-Cookie', 'Content-Type'],
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));

// Health check
app.get('/healthz', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    config: { VERIFY_TLS, CSM_BASEURL: CSM_BASEURL || 'auto' }
  });
});

// Session storage: sessionId -> { ipAddress, cookie, baseUrl, lastUsed }
const sessions = new Map<string, { ipAddress: string; cookie: string; baseUrl: string; lastUsed: number }>();
const serializeMap = new Map<string, Promise<any>>();
const inFlightLogin = new Map<string, Promise<any>>();

// Default NBI endpoint candidates
const DEFAULT_CANDIDATES = (ip: string) => [
  `http://${ip}:1741/nbi`,
  `http://${ip}:1741/nbi/v1`,
  `http://${ip}:1741`,
  `https://${ip}/nbi`,
  `https://${ip}/nbi/v1`,
  `https://${ip}:443/nbi`,
];

// Serialization per IP
function serialize(ip: string, fn: () => Promise<any>) {
  const last = serializeMap.get(ip) || Promise.resolve();
  const p = last.then(fn, fn).finally(() => {
    if (serializeMap.get(ip) === p) serializeMap.delete(ip);
  });
  serializeMap.set(ip, p.catch(() => {}));
  return p;
}

// Single-flight login per IP
function withSingleLogin(ip: string, fn: () => Promise<any>) {
  const last = inFlightLogin.get(ip) || Promise.resolve();
  const p = last.then(fn, fn).finally(() => {
    if (inFlightLogin.get(ip) === p) inFlightLogin.delete(ip);
  });
  inFlightLogin.set(ip, p.catch(() => {}));
  return p;
}

// Build login XML
function buildLoginXml(reqId: string, username: string, password: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<csm:loginRequest xmlns:csm="csm">
  <protVersion>1.0</protVersion>
  <reqId>${reqId}</reqId>
  <username>${username}</username>
  <password>${password}</password>
  <heartbeatRequested>false</heartbeatRequested>
</csm:loginRequest>`;
}

// Find existing valid session for IP
function findValidSession(ipAddress: string): { sessionId: string; session: any } | null {
  const SESSION_TIMEOUT = 10 * 60 * 1000; // 10 minutes (conservative)
  const now = Date.now();
  
  for (const [sessionId, session] of sessions.entries()) {
    if (session.ipAddress === ipAddress) {
      const age = now - session.lastUsed;
      if (age < SESSION_TIMEOUT) {
        console.log(`♻️ Found valid session for ${ipAddress} (age: ${Math.round(age/1000)}s, sessionId: ${sessionId})`);
        return { sessionId, session };
      } else {
        console.log(`⏰ Session expired for ${ipAddress} (age: ${Math.round(age/1000)}s, sessionId: ${sessionId})`);
        sessions.delete(sessionId);
      }
    }
  }
  return null;
}

// Cleanup session
async function cleanupSession(sessionId: string, agent: https.Agent) {
  const session = sessions.get(sessionId);
  if (!session?.cookie) return;

  try {
    const logoutXml = `<?xml version="1.0" encoding="UTF-8"?>
<csm:logoutRequest xmlns:csm="csm">
  <protVersion>1.0</protVersion>
  <reqId>${randomBytes(4).toString('hex')}</reqId>
</csm:logoutRequest>`;

    await axios.post(`${session.baseUrl}/logout`, logoutXml, {
      headers: {
        'Content-Type': 'application/xml',
        'Accept': 'application/xml',
        'Cookie': session.cookie,
      },
      httpAgent: new http.Agent(),
      httpsAgent: agent,
      timeout: 10000,
      validateStatus: () => true,
    });
  } catch (e) {
    console.log('⚠️ Logout failed (ignored):', (e as Error).message);
  }

  sessions.delete(sessionId);
}

// Main proxy endpoint
app.post('/csm-proxy', async (req, res) => {
  const { action, ipAddress, username, password, verifyTls, endpoint, body, sessionId } = req.body || {};
  const requestId = randomBytes(4).toString('hex');

  if (!ipAddress || !action) {
    return res.status(400).json({ ok: false, message: 'ipAddress and action required' });
  }

  const agent = new https.Agent({ rejectUnauthorized: verifyTls ?? VERIFY_TLS });

  return serialize(ipAddress, async () => {
    try {
      // LOGOUT
      if (action === 'logout') {
        console.log(`[${requestId}] 🚪 Logout for ${ipAddress}`);
        if (sessionId) {
          await cleanupSession(sessionId, agent);
        }
        return res.json({ ok: true, status: 200, statusText: 'Logged out' });
      }

      // LOGIN
      if (action === 'login') {
        // Check for existing valid session first
        const existing = findValidSession(ipAddress);
        if (existing) {
          console.log(`[${requestId}] ♻️ Reusing existing session for ${ipAddress}`);
          existing.session.lastUsed = Date.now();
          sessions.set(existing.sessionId, existing.session);
          return res.status(200).json({
            ok: true,
            status: 200,
            statusText: 'Session reused',
            sessionId: existing.sessionId,
            body: '',
          });
        }
        
        // No valid session - perform login
        return withSingleLogin(ipAddress, async () => {
          const expandOverride = (base: string) => {
            const b = base.replace(/\/+$/, '');
            const hasV1 = /\/v1$/.test(b);
            const withoutV1 = b.replace(/\/v1$/, '');
            const withV1 = hasV1 ? b : `${b}/v1`;
            return [b, withoutV1, withV1].filter((v, i, a) => a.indexOf(v) === i);
          };

          const candidateBases = CSM_BASEURL ? expandOverride(CSM_BASEURL) : DEFAULT_CANDIDATES(ipAddress);
          const loginXml = buildLoginXml(requestId, username || '', password || '');

          let resp: any = null;
          let bodyText = '';
          let lastTestedUrl = '';

          for (const currentBase of candidateBases) {
            const loginUrl = `${currentBase}/login`;
            lastTestedUrl = loginUrl;

            try {
              const r = await axios.post(loginUrl, loginXml, {
                headers: { 'Content-Type': 'application/xml', 'Accept': 'application/xml' },
                httpAgent: new http.Agent(),
                httpsAgent: agent,
                timeout: 30000,
                validateStatus: () => true,
                responseType: 'text',
                proxy: false,
              });

              resp = r;
              bodyText = String(r.data || '');
              const hasError = /<\s*error\b/i.test(bodyText);

              console.log(`[${requestId}] Login ${ipAddress} via ${loginUrl}: HTTP ${r.status}, Error: ${hasError}`);

              // Application error with Code 29
              if (r.status >= 200 && r.status < 300 && hasError) {
                if (/<error>\s*<code>\s*29\s*<\/code>/i.test(bodyText)) {
                  console.warn(`[${requestId}] Code 29 session conflict at ${loginUrl}`);
                  return res.status(423).json({
                    ok: false,
                    status: 423,
                    statusText: 'CSM session locked (Code 29) - please wait and retry',
                    body: bodyText,
                  });
                }

                const errorCode = bodyText.match(/<code>(\d+)<\/code>/i)?.[1] || 'unknown';
                const errorMsg = bodyText.match(/<message>([^<]+)<\/message>/i)?.[1] || 'Application error';
                console.error(`[${requestId}] CSM login error ${errorCode}: ${errorMsg}`);
                return res.status(400).json({
                  ok: false,
                  status: 400,
                  statusText: `CSM login failed (Error ${errorCode}): ${errorMsg}`,
                  body: bodyText,
                });
              }

              // Success: 2xx without error
              if (r.status >= 200 && r.status < 300 && !hasError) {
                const setCookieHeaders = r.headers['set-cookie'] || [];
                const setCookies = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
                const cookieParts = setCookies
                  .filter(Boolean)
                  .map(c => {
                    const match = /^([^=]+)=([^;]+)/.exec(c);
                    return match ? `${match[1]}=${match[2]}` : null;
                  })
                  .filter(Boolean);
                const mergedCookie = cookieParts.join('; ');

                const newSessionId = randomBytes(16).toString('hex');
                const timeoutMatch = bodyText.match(/<sessionTimeoutInMins>(\d+)<\/sessionTimeoutInMins>/i);
                const mins = timeoutMatch ? parseInt(timeoutMatch[1], 10) : 30;

                sessions.set(newSessionId, {
                  ipAddress,
                  cookie: mergedCookie,
                  baseUrl: currentBase,
                  lastUsed: Date.now(),
                });

                console.log(`[${requestId}] ✅ Login successful via ${loginUrl} (timeout ${mins}min, sessionId ${newSessionId})`);
                return res.status(200).json({
                  ok: true,
                  status: 200,
                  statusText: 'OK',
                  sessionId: newSessionId,
                  body: bodyText,
                });
              }

              console.log(`[${requestId}] Login failed at ${loginUrl}: HTTP ${r.status}`);
            } catch (e) {
              resp = (e as any)?.response || resp;
              bodyText = String(resp?.data || (e as Error)?.message || '');
              console.log(`[${requestId}] Login error at ${loginUrl}: ${(e as Error)?.message}`);
            }
          }

          // All candidates failed
          const finalStatus = resp?.status || 503;
          console.warn(`[${requestId}] CSM NBI not found. Last attempt: ${lastTestedUrl} (HTTP ${finalStatus})`);
          return res.status(503).json({
            ok: false,
            status: finalStatus,
            statusText: `CSM NBI Service not available (last: ${lastTestedUrl})`,
            body: bodyText,
          });
        });
      }

      // REQUEST
      if (action === 'request' && endpoint) {
        if (!sessionId) {
          console.warn(`[${requestId}] No session ID provided`);
          return res.status(401).json({ ok: false, status: 401, statusText: 'No session' });
        }

        const session = sessions.get(sessionId);
        if (!session) {
          console.warn(`[${requestId}] Session not found: ${sessionId}`);
          return res.status(401).json({ ok: false, status: 401, statusText: 'Session not found' });
        }

        // Update last used
        session.lastUsed = Date.now();
        sessions.set(sessionId, session);

        const endpointPath = endpoint.startsWith('/nbi/') ? endpoint.replace(/^\/nbi/, '') : endpoint;
        const url = `${session.baseUrl}${endpointPath.startsWith('/') ? '' : '/'}${endpointPath}`;

        console.log(`[${requestId}] Forwarding request:`, {
          endpoint,
          endpointPath,
          url,
          sessionId,
          baseUrl: session.baseUrl,
          bodyLength: body?.length || 0
        });

        let r;
        let text = '';
        
        try {
          r = await axios.post(url, body, {
            httpAgent: new http.Agent(),
            httpsAgent: agent,
            headers: {
            'Content-Type': 'application/xml',
            'Accept': 'application/xml',
            'Cookie': session.cookie,
          },
          validateStatus: () => true,
          responseType: 'text',
          timeout: 30000,
        });

          text = String(r.data || '');
        } catch (requestError) {
          const err = requestError as any;
          console.error(`[${requestId}] Network error calling CSM:`, {
            code: err.code,
            message: err.message,
            errno: err.errno,
            syscall: err.syscall,
            address: err.address,
            port: err.port,
            url
          });

          // Return 503 for network connectivity issues
          return res.status(503).json({
            ok: false,
            status: 503,
            statusText: `CSM Server nicht erreichbar: ${err.code || err.message}`,
            body: '',
          });
        }

        // Code 29: session conflict
        if (/<\s*code>\s*29\s*<\/code>/i.test(text)) {
          console.warn(`[${requestId}] Code 29 during request to ${endpoint}`);
          await cleanupSession(sessionId, agent);
          return res.status(423).json({
            ok: false,
            status: 423,
            statusText: 'CSM session locked (Code 29) - please login again',
            body: text,
          });
        }

        console.log(`[${requestId}] CSM responded: HTTP ${r!.status}, body length ${text.length}`);

        if (r!.status >= 400) {
          // Parse error details from CSM response
          const codeMatch = text.match(/<code>(\d+)<\/code>/i);
          const messageMatch = text.match(/<message>([^<]+)<\/message>/i);
          
          let errorMsg = `Request failed: HTTP ${r!.status}`;
          if (codeMatch || messageMatch) {
            const errorCode = codeMatch?.[1] || 'unknown';
            const errorMessage = messageMatch?.[1] || 'Unknown error';
            errorMsg = `CSM Error ${errorCode}: ${errorMessage}`;
            console.error(`[${requestId}] CSM API Error at ${endpoint}: Code ${errorCode}, Message: ${errorMessage}`);
          } else {
            console.error(`[${requestId}] HTTP ${r!.status} at ${endpoint}: ${text.substring(0, 200)}`);
          }
          
          return res.status(r!.status).json({
            ok: false,
            status: r!.status,
            statusText: errorMsg,
            body: text,
          });
        }

        return res.status(200).json({ ok: true, status: 200, statusText: 'OK', body: text });
      }

      return res.status(400).json({ ok: false, message: 'Invalid action' });
    } catch (err) {
      console.error(`[${requestId}] Error:`, (err as Error)?.message || err);
      return res.status(500).json({
        ok: false,
        status: (err as any)?.response?.status || 500,
        statusText: (err as Error)?.message || 'Proxy error',
        body: (err as any)?.response?.data || '',
      });
    }
  });
});

// Cleanup on shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Proxy shutdown - cleaning up sessions...');
  sessions.clear();
  serializeMap.clear();
  inFlightLogin.clear();
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`🚀 CSM Proxy listening on http://0.0.0.0:${PORT}`);
});
