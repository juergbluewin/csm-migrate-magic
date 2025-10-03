import express from 'express';
import path from 'path';
import https from 'https';
import axios from 'axios';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

app.use((req, res, next) => {
  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: '2mb' }));

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
<csm:logoutRequest xmlns:csm="csm">
  <csm:protVersion>1.0</csm:protVersion>
  <csm:reqId>${Math.random().toString(36).slice(2, 10)}</csm:reqId>
</csm:logoutRequest>`;
      
      await axios.post(`${baseUrl}/logout`, logoutXml, {
        headers: {
          'Content-Type': 'application/xml',
          'Accept': 'application/xml',
          'Cookie': session.cookie,
        },
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
          const candidates = [
            `https://${ipAddress}:443/nbi/login`,
            `https://${ipAddress}/nbi/login`,
            `http://${ipAddress}:1741/nbi/login`,
            `https://${ipAddress}:1741/nbi/login`,
          ];

          const loginXml = `<?xml version="1.0" encoding="UTF-8"?>
<csm:loginRequest xmlns:csm="csm">
  <csm:protVersion>1.0</csm:protVersion>
  <csm:reqId>${requestId}</csm:reqId>
  <csm:userName>${username}</csm:userName>
  <csm:password>${password}</csm:password>
</csm:loginRequest>`;

          let chosenBase = null;
          let resp = null;
          let bodyText = '';

          for (const url of candidates) {
            const currentBase = url.replace(/\/login$/, '');
            // alte Session auf dem Kandidaten bereinigen
            await cleanupSession(ipAddress, currentBase, agent);

            try {
              const r = await axios.post(url, loginXml, {
                headers: { 'Content-Type': 'application/xml', 'Accept': 'application/xml' },
                httpsAgent: agent,
                timeout: 30000,
                validateStatus: () => true,
              });
              resp = r;
              bodyText = String(r.data || '');
              const hasError = /<\s*error\b/i.test(bodyText);
              const ok = r.status >= 200 && r.status < 300 && !hasError;

              // Code 29: Session-Lock -> bereinigen und melden
              if (/<error>\s*<code>\s*29\s*<\/code>/i.test(bodyText)) {
                console.warn(`[CSM][CODE29] ${ipAddress} session conflict during login`);
                await cleanupSession(ipAddress, currentBase, agent);
                loginHints.delete(ipAddress);
                return res.status(423).json({
                  ok: false,
                  status: 423,
                  statusText: 'CSM session locked (Code 29)',
                  body: bodyText,
                });
              }

              if (ok) {
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

                console.log(`[${requestId}] ✅ CSM Login via ${currentBase}/login (timeout ${mins}min)`);
                return res.status(200).json({
                  ok: true,
                  status: 200,
                  statusText: 'OK',
                  body: bodyText,
                });
              }
            } catch (e) {
              resp = e?.response || resp;
              bodyText = String(resp?.data || e?.message || '');
            }
          }

          console.warn(`[${requestId}] ❌ CSM NBI nicht gefunden, letzte Antwort: HTTP ${resp?.status || 'n/a'}`);
          return res.status(503).json({
            ok: false,
            status: resp?.status || 503,
            statusText: 'CSM NBI Service nicht verfügbar',
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

        if ((r.status === 404 || r.status === 200) && /<\s*code>\s*29\s*<\/code>/i.test(text)) {
          await cleanupSession(ipAddress, hint.baseUrl, agent);
          loginHints.delete(ipAddress);
          return res.status(423).json({ ok: false, status: 423, statusText: 'CSM NB API session locked (29)', body: text });
        }
        if (r.status >= 400) return res.status(r.status).json({ ok: false, status: r.status, statusText: 'Proxy request error', body: text });

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

// Verbindungstest ohne Re-Login
app.post('/proxy/test', async (req, res) => {
  const { ipAddress, verifyTls } = req.body || {};
  const requestId = Math.random().toString(36).slice(2, 10);
  
  if (!ipAddress) {
    return res.status(400).json({ error: 'ipAddress required' });
  }

  const agent = new https.Agent({ rejectUnauthorized: verifyTls === true });
  const hint = loginHints.get(ipAddress);
  const baseUrl = hint?.baseUrl || `https://${ipAddress}/nbi`;
  const url = `${baseUrl}/configservice/getVersion`;
  
  // Cookie aus Session holen
  const session = sessions.get(ipAddress);
  const cookie = session?.cookie || '';

  try {
    // Test-Request gemäß Cisco CSM NBI API Spec
    const testXml = `<?xml version="1.0" encoding="UTF-8"?>
<csm:getVersionRequest xmlns:csm="csm">
  <csm:protVersion>1.0</csm:protVersion>
  <csm:reqId>${requestId}</csm:reqId>
</csm:getVersionRequest>`;
    
    const r = await axios.post(url, testXml, {
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
