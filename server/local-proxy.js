import express from 'express';
import path from 'path';
import http from 'node:http';
import https from 'node:https';
import axios from 'axios';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { z } from 'zod';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Default candidates for NBI endpoint discovery
// Prioritize HTTP :1741 for self-signed cert environments
const DEFAULT_CANDIDATES = (ip) => [
  `http://${ip}:1741/nbi`,
  `http://${ip}:1741/nbi/v1`,
  `http://${ip}:1741`,
  `https://${ip}/nbi`,
  `https://${ip}/nbi/v1`,
  `https://${ip}:443/nbi`,
];

// Manual base URL override from environment
const OVERRIDE_BASE = process.env.CSM_BASEURL?.replace(/\/+$/, '');

// CORS configuration for Same-Origin policy
const ORIGIN_WHITELIST = new Set([
  'http://localhost:3000',
  'http://127.0.0.1:3000',
]);
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ORIGIN_WHITELIST.has(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Vary', 'Origin');
    res.header('Access-Control-Allow-Credentials', 'true');
  }
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, apikey, x-client-info');
  res.header('Access-Control-Expose-Headers', 'Set-Cookie, Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});


app.use(express.json({ limit: '2mb' }));

// Health check endpoint for Docker
app.get('/healthz', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Session-Speicher: IP -> { cookie, baseUrl, lastUsed }
const sessions = new Map();
const loginHints = new Map(); // IP -> { baseUrl, expiresAt }
const serializeMap = new Map(); // IP -> Promise chain
const inFlightLogin = new Map(); // IP -> Promise

// Logout + Session bereinigen
async function cleanupSession(ipAddress, baseUrl, agent) {
  const session = sessions.get(ipAddress);
  
  if (session?.cookie) {
    try {
      // Logout gemäß Cisco CSM NBI API Spec v2.4 (Figure 16, Page 40)
      const logoutXml = `<?xml version="1.0" encoding="UTF-8"?>
<logoutRequest xmlns="csm">
  <protVersion>2.0</protVersion>
  <reqId>${Math.random().toString(36).slice(2, 10)}</reqId>
</logoutRequest>`;
      
      await axios.post(`${baseUrl}/logout`, logoutXml, {
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
      console.log(`⚠️ Logout failed (ignored):`, e.message);
    }
  }
  
  sessions.delete(ipAddress);
  loginHints.delete(ipAddress);
}

// Serialisierung pro IP gegen Race Conditions
function serialize(ip, fn) {
  const last = serializeMap.get(ip) || Promise.resolve();
  const p = last.then(fn, fn).finally(() => { 
    if (serializeMap.get(ip) === p) serializeMap.delete(ip); 
  });
  serializeMap.set(ip, p.catch(() => {}));
  return p;
}

// Single-Flight für Logins pro IP
function withSingleLogin(ip, fn) {
  const last = inFlightLogin.get(ip) || Promise.resolve();
  const p = last.then(fn, fn).finally(() => { 
    if (inFlightLogin.get(ip) === p) inFlightLogin.delete(ip); 
  });
  inFlightLogin.set(ip, p.catch(() => {}));
  return p;
}

// Session-Validierung: Cookie vorhanden und nicht abgelaufen?
function hasSession(ip) {
  const session = sessions.get(ip);
  if (!session?.cookie) return false;
  
  const hint = loginHints.get(ip);
  if (hint?.expiresAt && Date.now() > hint.expiresAt) return false;
  
  return true;
}

// Pfad mit /nbi prefixen falls nötig
function resolvePath(ip, incomingPath) {
  const basePath = loginHints.get(ip)?.basePath || '/nbi';
  
  if (incomingPath.startsWith('/nbi/')) return incomingPath;
  
  const needsPrefix = /^\/(configservice|securityservice|userservice|deviceservice|policymanager|utilservice)\b/i.test(incomingPath);
  return needsPrefix ? `${basePath}${incomingPath}` : incomingPath;
}

// Build login XML with correct format for CSM v2.0
function buildLoginXml({ reqId, username, password }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<loginRequest xmlns="csm">
  <protVersion>2.0</protVersion>
  <reqId>${reqId}</reqId>
  <username>${username}</username>
  <password>${password}</password>
</loginRequest>`;
}

app.post('/csm-proxy', async (req, res) => {
  const { action, ipAddress, username, password, verifyTls, endpoint, body } = req.body || {};
  const requestId = Math.random().toString(36).slice(2, 10);

  if (!ipAddress || !action) {
    return res.status(400).json({ error: 'ipAddress and action required' });
  }

  const agent = new https.Agent({ rejectUnauthorized: verifyTls === true });
  const protocol = 'https';
  const port = '';
  const baseUrl = `${protocol}://${ipAddress}${port}/nbi`;

  return serialize(ipAddress, async () => {
    try {
      // Logout
        if (action === 'logout') {
          console.log(`[${requestId}] 🚪 Logout for ${ipAddress}`);
          const hint = loginHints.get(ipAddress);
          const logoutBase = hint?.baseUrl || baseUrl;
          await cleanupSession(ipAddress, logoutBase, agent);
          return res.json({ ok: true, status: 200, statusText: 'Logged out', body: '<logout/>' });
        }

      // Login
      if (action === 'login') {
        // Wenn Session existiert und gültig, keinen neuen Login
        if (hasSession(ipAddress)) {
          console.log(`[${requestId}] ✅ Session already exists, no new login needed`);
          return res.status(200).json({
            ok: true,
            status: 200,
            statusText: 'Already logged in',
            body: '<?xml version="1.0" encoding="UTF-8"?><csm:loginResponse xmlns:csm="csm"><protVersion>1.0</protVersion></csm:loginResponse>',
          });
        }

        return withSingleLogin(ipAddress, async () => {
          // Endpoint-Discovery: mehrere Kandidaten testen und Basis-URL speichern
          const expandOverride = (base) => {
  const b = base.replace(/\/+$/, '');
  const hasV1 = /\/v1$/.test(b);
  const withoutV1 = b.replace(/\/v1$/, '');
  const withV1 = hasV1 ? b : `${b}/v1`;
  // Reihenfolge: exakt, ohne /v1, mit /v1
  const arr = [b, withoutV1, withV1].filter((v, i, a) => a.indexOf(v) === i);
  return arr;
};
const candidateBases = OVERRIDE_BASE ? expandOverride(OVERRIDE_BASE) : DEFAULT_CANDIDATES(ipAddress);

          const loginXml = buildLoginXml({ reqId: requestId, username, password });

          let chosenBase = null;
          let resp = null;
          let bodyText = '';
          let lastTestedUrl = '';

          for (const currentBase of candidateBases) {
            const loginUrl = `${currentBase}/login`;
            lastTestedUrl = loginUrl;
            
            // alte Session auf dem Kandidaten bereinigen
            await cleanupSession(ipAddress, currentBase, agent);

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
              
              console.log(`[CSM][LOGIN] ${ipAddress} via ${loginUrl}: HTTP ${r.status}, Has Error: ${hasError}`);

              // Bei 2xx mit <error>: Anwendungsfehler, nicht auf andere Ports ausweichen
              if (r.status >= 200 && r.status < 300 && hasError) {
                // Code 29: Session-Lock
                if (/<error>\s*<code>\s*29\s*<\/code>/i.test(bodyText)) {
                  console.warn(`[CSM][CODE29] ${ipAddress} session conflict during login at ${loginUrl}`);
                  await cleanupSession(ipAddress, currentBase, agent);
                  loginHints.delete(ipAddress);
                  return res.status(423).json({
                    ok: false,
                    status: 423,
                    statusText: 'CSM session locked (Code 29) - please wait and retry',
                    body: bodyText,
                  });
                }
                
                // Anwendungsfehler (kein Weiterprobieren anderer Kandidaten)
                const errorCode = bodyText.match(/<code>(\d+)<\/code>/i)?.[1] || 'unknown';
                const errorMsg = bodyText.match(/<message>([^<]+)<\/message>/i)?.[1] || 'Application error';
                console.error(`[${requestId}] ❌ CSM Login App Error ${errorCode} at ${loginUrl}: ${errorMsg}`);
                await cleanupSession(ipAddress, currentBase, agent);
                loginHints.delete(ipAddress);
                return res.status(423).json({
                  ok: false,
                  status: 423,
                  statusText: `CSM NB API application error (Error ${errorCode}): ${errorMsg}`,
                  body: bodyText,
                });
              }

              // Erfolg: 2xx ohne <error>
              if (r.status >= 200 && r.status < 300 && !hasError) {
                // Cookies zusammenführen
                const setCookieHeaders = r.headers['set-cookie'] || [];
                const setCookies = Array.isArray(setCookieHeaders) ? setCookieHeaders : (setCookieHeaders ? [setCookieHeaders] : []);
                const cookieParts = [];
                for (const c of setCookies) {
                  const match = /^([^=]+)=([^;]+)/.exec(c);
                  if (match) cookieParts.push(`${match[1]}=${match[2]}`);
                }
                const mergedCookie = cookieParts.join('; ');

                const timeoutMatch = bodyText.match(/<sessionTimeoutInMins>(\d+)<\/sessionTimeoutInMins>/i);
                const mins = timeoutMatch ? parseInt(timeoutMatch[1], 10) : 30;
                const expiresAt = Date.now() + mins * 60 * 1000;

                sessions.set(ipAddress, { cookie: mergedCookie, baseUrl: currentBase, lastUsed: Date.now() });
                loginHints.set(ipAddress, { baseUrl: currentBase, expiresAt });

                console.log(`[${requestId}] ✅ CSM Login via ${loginUrl} (timeout ${mins}min)`);
                return res.status(200).json({
                  ok: true,
                  status: 200,
                  statusText: 'OK',
                  body: bodyText,
                });
              }
              
              // Sonstige Fehler (4xx, 5xx) -> nächsten Kandidaten probieren
              console.log(`[${requestId}] ⚠️ Login attempt failed at ${loginUrl}: HTTP ${r.status}`);
              
            } catch (e) {
              resp = e?.response || resp;
              bodyText = String(resp?.data || e?.message || '');
              console.log(`[${requestId}] ⚠️ Login attempt error at ${loginUrl}: ${e?.message}`);
            }
          }

          // Alle Kandidaten fehlgeschlagen
          const finalStatus = resp?.status || 503;
          console.warn(`[${requestId}] ❌ CSM NBI nicht gefunden. Letzter Versuch: ${lastTestedUrl} (HTTP ${finalStatus})`);
          return res.status(503).json({
            ok: false,
            status: finalStatus,
            statusText: `CSM NBI Service nicht verfügbar (letzter Versuch: ${lastTestedUrl})`,
            body: bodyText,
          });
        });
      }

      // Request
      if (action === 'request' && endpoint) {
        const hint = loginHints.get(ipAddress);
        if (!hint?.baseUrl) return res.status(401).json({ ok: false, status: 401, statusText: 'Keine Session' });

        const endpointPath = endpoint.startsWith('/nbi/') ? endpoint.replace(/^\/nbi/, '') : endpoint;
        const url = `${hint.baseUrl}${endpointPath.startsWith('/') ? '' : '/'}${endpointPath}`;

        const session = sessions.get(ipAddress);
        const cookieStr = session?.cookie || '';

        const send = () => axios.post(url, body, {
          httpAgent: new http.Agent(),
          httpsAgent: agent,
          headers: {
            'Content-Type': 'application/xml',
            'Accept': 'application/xml',
            ...(cookieStr ? { 'Cookie': cookieStr } : {}),
          },
          validateStatus: () => true,
          responseType: 'text',
          timeout: 30000,
        });

        let r = await send();
        const text = String(r.data || '');

        // Code 29 in beliebigem Status: Session bereinigen, 423 zurückgeben
        if (/<\s*code>\s*29\s*<\/code>/i.test(text)) {
          console.warn(`[CSM][CODE29] ${ipAddress} session conflict during request to ${endpoint}`);
          await cleanupSession(ipAddress, hint.baseUrl, agent);
          loginHints.delete(ipAddress);
          return res.status(423).json({ 
            ok: false, 
            status: 423, 
            statusText: 'CSM session locked (Code 29) - please login again', 
            body: text 
          });
        }
        
        // HTTP-Fehler ohne Code 29
        if (r.status >= 400) {
          return res.status(r.status).json({ 
            ok: false, 
            status: r.status, 
            statusText: `Request failed: HTTP ${r.status}`, 
            body: text 
          });
        }

        return res.status(200).json({ ok: true, status: 200, statusText: 'OK', body: text });
      }

      return res.status(400).json({ error: 'Invalid action' });
      
    } catch (err) {
      console.error(`[${requestId}] Error:`, err?.message || err);
      return res.status(500).json({ 
        ok: false, 
        status: err?.response?.status || 500, 
        statusText: err?.message || 'Proxy error', 
        body: err?.response?.data || '' 
      });
    }
  });
});

// API Login endpoint with validation
const loginSchema = z.object({
  ipAddress: z.string().regex(/^(?:\d{1,3}\.){3}\d{1,3}$|^[\w.-]+$/, 'Invalid IP address or hostname'),
  username: z.string().trim().min(1, 'Username required').max(100),
  password: z.string().min(1, 'Password required').max(255),
  verifyTls: z.boolean().optional(),
});

app.post('/api/login', express.json(), async (req, res) => {
  const requestId = Math.random().toString(36).slice(2, 10);
  
  try {
    // Validate input
    const validated = loginSchema.parse(req.body);
    const { ipAddress, username, password, verifyTls } = validated;
    
    const agent = new https.Agent({ rejectUnauthorized: verifyTls === true });
    
    // Check if session already exists
    if (hasSession(ipAddress)) {
      console.log(`[${requestId}] ✅ Session already exists for ${ipAddress}`);
      return res.status(200).json({
        ok: true,
        status: 200,
        message: 'Already logged in',
      });
    }
    
    return serialize(ipAddress, async () => {
      return withSingleLogin(ipAddress, async () => {
        const candidateBases = OVERRIDE_BASE 
          ? [OVERRIDE_BASE] 
          : DEFAULT_CANDIDATES(ipAddress);
        
        const loginXml = buildLoginXml({ reqId: requestId, username, password });
        
        let chosenBase = null;
        let resp = null;
        let bodyText = '';
        
        for (const currentBase of candidateBases) {
          const loginUrl = `${currentBase}/login`;
          await cleanupSession(ipAddress, currentBase, agent);
          
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
            
            console.log(`[${requestId}] Login attempt ${ipAddress} via ${loginUrl}: HTTP ${r.status}, Has Error: ${hasError}`);
            
            // Application error with error code
            if (r.status >= 200 && r.status < 300 && hasError) {
              if (/<error>\s*<code>\s*29\s*<\/code>/i.test(bodyText)) {
                console.warn(`[${requestId}] Code 29 session conflict at ${loginUrl}`);
                await cleanupSession(ipAddress, currentBase, agent);
                loginHints.delete(ipAddress);
                return res.status(423).json({
                  ok: false,
                  status: 423,
                  message: 'CSM session locked (Code 29) - please wait and retry',
                });
              }
              
              const errorCode = bodyText.match(/<code>(\d+)<\/code>/i)?.[1] || 'unknown';
              const errorMsg = bodyText.match(/<message>([^<]+)<\/message>/i)?.[1] || 'Application error';
              console.error(`[${requestId}] CSM login error ${errorCode}: ${errorMsg}`);
              return res.status(400).json({
                ok: false,
                status: 400,
                message: `CSM login failed (Error ${errorCode}): ${errorMsg}`,
              });
            }
            
            // Success: 2xx without error
            if (r.status >= 200 && r.status < 300 && !hasError) {
              const setCookieHeaders = r.headers['set-cookie'] || [];
              const setCookies = Array.isArray(setCookieHeaders) ? setCookieHeaders : (setCookieHeaders ? [setCookieHeaders] : []);
              const cookieParts = [];
              for (const c of setCookies) {
                const match = /^([^=]+)=([^;]+)/.exec(c);
                if (match) cookieParts.push(`${match[1]}=${match[2]}`);
              }
              const mergedCookie = cookieParts.join('; ');
              
              const timeoutMatch = bodyText.match(/<sessionTimeoutInMins>(\d+)<\/sessionTimeoutInMins>/i);
              const mins = timeoutMatch ? parseInt(timeoutMatch[1], 10) : 30;
              const expiresAt = Date.now() + mins * 60 * 1000;
              
              sessions.set(ipAddress, { cookie: mergedCookie, baseUrl: currentBase, lastUsed: Date.now() });
              loginHints.set(ipAddress, { baseUrl: currentBase, expiresAt });
              
              console.log(`[${requestId}] ✅ Login successful via ${loginUrl} (timeout ${mins}min)`);
              return res.status(200).json({
                ok: true,
                status: 200,
                message: 'Login successful',
                sessionTimeout: mins,
              });
            }
            
            console.log(`[${requestId}] Login failed at ${loginUrl}: HTTP ${r.status}`);
          } catch (e) {
            resp = e?.response || resp;
            bodyText = String(resp?.data || e?.message || '');
            console.log(`[${requestId}] Login error at ${loginUrl}: ${e?.message}`);
          }
        }
        
        // All candidates failed
        const finalStatus = resp?.status || 503;
        console.warn(`[${requestId}] CSM NBI not found. Status: ${finalStatus}`);
        return res.status(503).json({
          ok: false,
          status: finalStatus,
          message: 'CSM NBI service not available',
        });
      });
    });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return res.status(400).json({
        ok: false,
        status: 400,
        message: 'Validation error',
        errors: e.errors.map(err => ({ field: err.path.join('.'), message: err.message })),
      });
    }
    
    console.error(`[${requestId}] Login error:`, e?.message || e);
    return res.status(500).json({
      ok: false,
      status: 500,
      message: e?.message || 'Internal server error',
    });
  }
});

// Verbindungstest ohne Re-Login
app.post('/proxy/test', async (req, res) => {
  const { ipAddress, verifyTls } = req.body || {};
  const requestId = Math.random().toString(36).slice(2, 10);
  
  if (!ipAddress) {
    return res.status(400).json({ error: 'ipAddress required' });
  }

  const agent = new https.Agent({ rejectUnauthorized: verifyTls === true });
  const hint = loginHints.get(ipAddress);
  const baseUrl = hint?.baseUrl || `http://${ipAddress}:1741/nbi/v1`;
  const url = `${baseUrl}/configservice/getVersion`;
  
  // Cookie aus Session holen
  const session = sessions.get(ipAddress);
  const cookie = session?.cookie || '';

  try {
    // Test-Request gemäß Cisco CSM NBI API Spec
    const testXml = `<?xml version="1.0" encoding="UTF-8"?>
<getVersionRequest xmlns="csm">
  <protVersion>2.0</protVersion>
  <reqId>${requestId}</reqId>
</getVersionRequest>`;
    
    const r = await axios.post(url, testXml, {
      httpAgent: new http.Agent(),
      httpsAgent: agent,
      headers: { 
        'Content-Type': 'application/xml', 
        'Accept': 'application/xml', 
        ...(cookie ? { 'Cookie': cookie } : {}) 
      },
      timeout: 15000,
      validateStatus: () => true,
    });
    
    console.log(`[${requestId}] /proxy/test -> ${url} (${r.status})`);
    
    const data = String(r.data || '');
    
    // Bei Code 29 cleanup
    if (/<code>\s*29\s*<\/code>/i.test(data)) {
      console.warn(`[CSM][CODE29] ${ipAddress} session conflict during test`);
      await cleanupSession(ipAddress, baseUrl, agent);
      return res.status(423).json({ 
        ok: false, 
        status: 423, 
        statusText: 'CSM session locked (Code 29) - please login again' 
      });
    }
    
    return res.status(200).json({ 
      ok: r.status === 200 && !/<error>/i.test(data), 
      status: r.status, 
      body: r.data 
    });
  } catch (e) {
    const data = String(e?.response?.data || '');
    if (/<code>\s*29\s*<\/code>/i.test(data)) {
      console.warn(`[CSM][CODE29] ${ipAddress} session conflict during test`);
      await cleanupSession(ipAddress, baseUrl, agent);
      return res.status(423).json({ 
        ok: false, 
        status: 423, 
        statusText: 'CSM session locked (Code 29) - please login again' 
      });
    }
    
    return res.status(500).json({ 
      ok: false, 
      status: e?.response?.status || 500, 
      statusText: e?.message || 'test failed' 
    });
  }
});

// Static hosting
const distPath = path.join(__dirname, '..', 'dist');
app.use(express.static(distPath));
app.use((req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

// Cleanup bei Prozessende
process.on('SIGINT', () => {
  console.log('\n🛑 Server shutdown - cleaning up sessions...');
  sessions.clear();
  loginHints.clear();
  serializeMap.clear();
  inFlightLogin.clear();
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`🚀 Local server + CSM proxy listening on http://0.0.0.0:${PORT}`);
});
