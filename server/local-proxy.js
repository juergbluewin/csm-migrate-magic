import express from 'express';
import path from 'path';
import https from 'https';
import axios from 'axios';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { CookieJar } from 'tough-cookie';

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

function isPrivateIP(ip) {
  const parts = (ip || '').split('.').map(Number);
  if (parts.length !== 4) return false;
  if (parts[0] === 10) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 127) return true;
  return false;
}

const loginHints = new Map();
const cookieJars = new Map();
const sessions = new Map(); // IP -> { cookie, baseUrl, lastUsed }

function jarFor(ip) {
  if (!cookieJars.has(ip)) cookieJars.set(ip, new CookieJar());
  return cookieJars.get(ip);
}

function cookieHeaderFor(ip, url) {
  try { 
    return jarFor(ip).getCookieStringSync(url); 
  } catch { 
    return ''; 
  }
}

// Logout + Cookie-Clear für saubere Session-Beendigung
async function cleanupSession(ipAddress, baseUrl, agent) {
  const session = sessions.get(ipAddress);
  
  if (session && session.cookie) {
    try {
      const logoutXml = '<?xml version="1.0" encoding="UTF-8"?>\n<csm:logoutRequest xmlns:csm="csm"/>';
      await axios.post(`${baseUrl}/logout`, logoutXml, {
        headers: {
          'Content-Type': 'application/xml',
          'Accept': 'application/xml',
          'User-Agent': 'curl/8.5.0',
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

  // Session löschen
  sessions.delete(ipAddress);
}

// einfache Queue pro IP, um Race Conditions zu verhindern
const inFlight = new Map();
async function serialize(ip, fn) {
  const last = inFlight.get(ip) || Promise.resolve();
  const p = last.then(fn, fn);
  inFlight.set(ip, p.catch(() => {}));
  return p;
}

// Single-flight speziell für Logins pro IP
const inFlightLogin = new Map();
async function withSingleLogin(ip, fn) {
  const last = inFlightLogin.get(ip) || Promise.resolve();
  const p = last.then(fn, fn);
  inFlightLogin.set(ip, p.catch(() => {}));
  return p;
}

// Session-Prüfung: gültiges asCookie vorhanden?
function hasSession(ip) {
  const session = sessions.get(ip);
  return session && session.cookie && session.lastUsed && (Date.now() - session.lastUsed < 30 * 60 * 1000); // 30min
}

function resolvePath(ip, incomingPath) {
  const hint = loginHints.get(ip);
  const basePath = hint?.basePath || '';
  if (incomingPath.startsWith('/nbi/')) return incomingPath;
  const needsPrefix = /^\/(configservice|securityservice|userservice|deviceservice|policymanager)\b/i.test(incomingPath);
  return needsPrefix ? `${basePath}${incomingPath}` : incomingPath;
}

app.post('/csm-proxy', async (req, res) => {
  const { action, ipAddress, username, password, verifyTls, endpoint, body, cookie } = req.body || {};
  const requestId = Math.random().toString(36).slice(2, 10);

  try {
    if (!ipAddress) return res.status(400).json({ error: 'ipAddress required' });

    const baseUrl = `https://${ipAddress}/nbi`;
    const agent = new https.Agent({ rejectUnauthorized: verifyTls === true });

    console.log(`[${requestId}] CSM Local Proxy ->`, { action, ipAddress, endpoint: endpoint || '/nbi/login', verifyTls, isPrivateIP: isPrivateIP(ipAddress) });

    // Logout-Aktion
    if (action === 'logout') {
      return serialize(ipAddress, async () => {
        const protocol2 = verifyTls === false ? 'http' : 'https';
        const port2 = verifyTls === false ? ':80' : '';
        const baseUrl = `${protocol2}://${ipAddress}${port2}/nbi`;
        const agent = new https.Agent({ rejectUnauthorized: verifyTls !== false });

        console.log(`[${requestId}] 🚪 Logout request for ${ipAddress}`);
        await cleanupSession(ipAddress, baseUrl, agent);

        return res.json({
          ok: true,
          status: 200,
          statusText: 'Logout erfolgreich',
        });
      });
    }

    if (action === 'login') {
      return await withSingleLogin(ipAddress, async () => {
        const protocol = 'https';
        const port = 443;
        const baseUrl = `${protocol}://${ipAddress}:${port}/nbi`;

        // Wenn Session existiert und Cookie gültig, keinen neuen Login
        if (hasSession(ipAddress)) {
          const session = sessions.get(ipAddress);
          console.log(`[${requestId}] ✅ Session bereits vorhanden, kein neuer Login nötig`);
          return res.status(200).json({
            ok: true,
            status: 200,
            statusText: 'OK',
            body: '<?xml version="1.0" encoding="UTF-8"?><csm:loginResponse xmlns:csm="csm"><protVersion>1.0</protVersion></csm:loginResponse>',
            headers: { 'set-cookie': [`asCookie=${session.cookie}; Path=/; HttpOnly`] },
          });
        }

        // Kanonisches Login-XML gemäß offiziellem Cisco CSM API Spec
        const loginXml = `<?xml version="1.0" encoding="UTF-8"?>\n<csm:loginRequest xmlns:csm="csm">\n  <protVersion>1.0</protVersion>\n  <username>${username}</username>\n  <password>${password}</password>\n</csm:loginRequest>`;

        // WICHTIG: Bei neuem Login-Versuch alte Session explizit beenden
        console.log(`[${requestId}] 🔄 Cleaning up any existing session before login`);
        await cleanupSession(ipAddress, baseUrl, agent);

        const url = `${baseUrl}/login`;
        const response = await axios.post(url, loginXml, {
          headers: {
            'Content-Type': 'application/xml',
            'Accept': 'application/xml',
            'User-Agent': 'curl/8.5.0',
          },
          httpsAgent: agent,
          timeout: 30000,
          responseType: 'text',
          validateStatus: () => true,
          maxRedirects: 0,
          proxy: false,
        });

        // Set-Cookie Headers zusammenführen
        const setCookieHeaders = response.headers['set-cookie'] || response.headers['Set-Cookie'] || [];
        const setCookies = Array.isArray(setCookieHeaders) ? setCookieHeaders : (setCookieHeaders ? [setCookieHeaders] : []);
        
        const cookieParts = [];
        for (const c of setCookies) {
          const match = /^([^=]+)=([^;]+)/.exec(c);
          if (match) cookieParts.push(`${match[1]}=${match[2]}`);
        }
        const mergedCookie = cookieParts.join('; ');

        const bodyText = String(response.data || '');
        const isLoginResponse = /<(?:csm:)?loginResponse[\s>]/i.test(bodyText);
        const hasAsCookie = setCookies.some(c => /^asCookie=/.test(c));

        if (response.status === 200 && (isLoginResponse || hasAsCookie)) {
          sessions.set(ipAddress, { cookie: mergedCookie, baseUrl, lastUsed: Date.now() });
          loginHints.set(ipAddress, { protocol, port, basePath: '/nbi', loginPath: '/nbi/login', loginXml });
          return res.status(200).json({
            ok: true,
            status: response.status,
            statusText: response.statusText,
            body: response.data,
            headers: { 'set-cookie': setCookies },
            variant: 'single-login',
          });
        }

        // Fehler: explizit prüfen auf Code 29
        if (/<error><code>29<\/code>/i.test(bodyText)) {
          console.log(`[${requestId}] ⚠️ Error Code 29 detected - user already logged in`);
          await cleanupSession(ipAddress, baseUrl, agent);
          await new Promise(resolve => setTimeout(resolve, 500));
          // Ein Retry
          const retryResponse = await axios.post(url, loginXml, {
            headers: {
              'Content-Type': 'application/xml',
              'Accept': 'application/xml',
              'User-Agent': 'curl/8.5.0',
            },
            httpsAgent: agent,
            timeout: 30000,
            responseType: 'text',
            validateStatus: () => true,
            maxRedirects: 0,
            proxy: false,
          });
          const retryCookies = retryResponse.headers['set-cookie'] || retryResponse.headers['Set-Cookie'] || [];
          const retryArr = Array.isArray(retryCookies) ? retryCookies : (retryCookies ? [retryCookies] : []);
          const retryParts = [];
          for (const c of retryArr) {
            const match = /^([^=]+)=([^;]+)/.exec(c);
            if (match) retryParts.push(`${match[1]}=${match[2]}`);
          }
          const retryMerged = retryParts.join('; ');
          if (retryResponse.status === 200) {
            sessions.set(ipAddress, { cookie: retryMerged, baseUrl, lastUsed: Date.now() });
            loginHints.set(ipAddress, { protocol, port, basePath: '/nbi', loginPath: '/nbi/login', loginXml });
            return res.status(200).json({
              ok: true,
              status: retryResponse.status,
              statusText: retryResponse.statusText,
              body: retryResponse.data,
              headers: { 'set-cookie': retryArr },
              variant: 'retry-after-29',
            });
          }
        }

        // Kein Discovery mehr – explizit den Fehler durchreichen
        return res.status(response.status).send(response.data);
      });
    }

    if (action === 'request' && endpoint) {
      const resolvedEndpoint = resolvePath(ipAddress, endpoint);
      const hint2 = loginHints.get(ipAddress) || {};
      const protocol2 = hint2.protocol || 'https';
      const port2 = hint2.port ? `:${hint2.port}` : '';
      const fullUrl = resolvedEndpoint.startsWith('http') ? resolvedEndpoint : `${protocol2}://${ipAddress}${port2}${resolvedEndpoint}`;
      const start = Date.now();
      
      // Cookie aus Session holen
      const session = sessions.get(ipAddress);
      const cookieStr = session?.cookie || '';

      const send = async () => axios.post(fullUrl, body, {
        headers: {
          'Content-Type': 'application/xml',
          'Accept': 'application/xml',
          'User-Agent': 'curl/8.5.0',
          ...(cookieStr ? { 'Cookie': cookieStr } : {}),
        },
        httpsAgent: agent,
        timeout: 30000,
        responseType: 'text',
        validateStatus: () => true,
        maxRedirects: 0,
        proxy: false,
      });

      let response = await send();

      // Session-Timeout aktualisieren
      if (session) {
        session.lastUsed = Date.now();
        sessions.set(ipAddress, session);
      }

      // Bei 401 oder 404 mit loginResponse oder XML-Fehler mit Code 29: einmalig re-login
      const bodyText1 = String(response.data || '');
      const looksLikeLoginResponse = /<(?:\w+:)?loginResponse[\s>]/i.test(bodyText1);
      const hasCode29 = /<error><code>29<\/code>/i.test(bodyText1);
      
      if ((response.status === 401 || (response.status === 404 && looksLikeLoginResponse) || hasCode29) && hint2.loginPath && hint2.loginXml) {
        console.log(`[${requestId}] 🔄 Got ${response.status} ${hasCode29 ? '(Code 29)' : looksLikeLoginResponse ? '(loginResponse)' : ''} - attempting silent re-login`);
        await withSingleLogin(ipAddress, async () => {
          // Erst alte Session sauber beenden
          const baseUrlForCleanup = `${protocol2}://${ipAddress}${port2}${hint2.basePath || ''}`;
          await cleanupSession(ipAddress, baseUrlForCleanup, agent);
          
          // 500ms warten
          await new Promise(resolve => setTimeout(resolve, 500));
          
          // Dann neu einloggen
          const loginUrl = `${protocol2}://${ipAddress}${port2}${hint2.loginPath}`;
          const lr = await axios.post(loginUrl, hint2.loginXml, {
            headers: {
              'Content-Type': 'application/xml',
              'Accept': 'application/xml',
              'User-Agent': 'curl/8.5.0',
            },
            httpsAgent: agent,
            timeout: 30000,
            responseType: 'text',
            validateStatus: () => true,
            maxRedirects: 0,
            proxy: false,
          });
          const sc = lr.headers['set-cookie'] || lr.headers['Set-Cookie'] || [];
          const scArr = Array.isArray(sc) ? sc : (sc ? [sc] : []);
          const cookieParts = [];
          for (const c of scArr) {
            const match = /^([^=]+)=([^;]+)/.exec(c);
            if (match) cookieParts.push(`${match[1]}=${match[2]}`);
          }
          const merged = cookieParts.join('; ');
          if (merged) {
            sessions.set(ipAddress, { cookie: merged, baseUrl: baseUrlForCleanup, lastUsed: Date.now() });
          }
        });
        response = await send();
      }

      const duration = Date.now() - start;
      console.log(`[${requestId}] <- API Response (${resolvedEndpoint})`, { 
        status: response.status, 
        ok: response.status >= 200 && response.status < 300, 
        duration: `${duration}ms`,
        hasCookie: !!cookieStr
      });

      return res.status(200).json({
        ok: response.status >= 200 && response.status < 300,
        status: response.status,
        statusText: response.statusText,
        body: response.data,
      });
    }

    return res.status(400).json({ error: 'Invalid action' });
  } catch (error) {
    console.error(`[${requestId}] ❌ Local Proxy Error:`, error?.message);
    return res.status(500).json({ error: error?.message || 'Internal server error', details: String(error), requestId });
  }
});

// Verbindung testen ohne Re-Login und ohne Cookie-Reset
app.post('/proxy/test', async (req, res) => {
  const { ipAddress, verifyTls } = req.body || {};
  const requestId = Math.random().toString(36).slice(2, 10);
  if (!ipAddress) return res.status(400).json({ error: 'ipAddress required' });

  return serialize(ipAddress, async () => {
    try {
      const hint = loginHints.get(ipAddress) || {};
      const protocol = hint.protocol || 'https';
      const port = hint.port ? `:${hint.port}` : '';
      const agent = new https.Agent({ rejectUnauthorized: verifyTls === true });

      const testPath = resolvePath(ipAddress, '/configservice/getVersion');
      const targetUrl = `${protocol}://${ipAddress}${port}${testPath}`;

      const headers = {
        'Content-Type': 'application/xml',
        'Accept': 'application/xml',
        'User-Agent': 'curl/8.5.0',
      };
      const cookies = cookieHeaderFor(ipAddress, targetUrl);
      if (cookies) headers['Cookie'] = cookies;

      const testBody = '<getVersionRequest xmlns="csm"/>';
      const start = Date.now();
      const resp = await axios.post(targetUrl, testBody, {
        headers,
        httpsAgent: agent,
        timeout: 15000,
        responseType: 'text',
        validateStatus: () => true,
        proxy: false,
      });
      const duration = Date.now() - start;
      console.log(`[${requestId}] /proxy/test -> ${targetUrl}`, { status: resp.status, duration: `${duration}ms`, hasCookie: !!cookies });

      // Set-Cookie aus der Antwort persistent in die Jar übernehmen
      const setCookieResp = resp.headers['set-cookie'] || resp.headers['Set-Cookie'] || [];
      const arr = Array.isArray(setCookieResp) ? setCookieResp : (setCookieResp ? [setCookieResp] : []);
      if (arr.length > 0) {
        const jar = jarFor(ipAddress);
        for (const c of arr) {
          try { jar.setCookieSync(c, targetUrl); } catch {}
        }
      }

      const isXml = /^\s*</.test(String(resp.data || ''));
      return res.status(200).json({
        ok: resp.status === 200 && isXml,
        status: resp.status,
        statusText: resp.statusText,
        body: resp.data,
      });
    } catch (e) {
      console.error(`[${requestId}] /proxy/test error`, e?.message || e);
      return res.status(500).json({ error: e?.message || 'Internal error' });
    }
  });
});

// Static hosting
const distPath = path.join(__dirname, '..', 'dist');
app.use(express.static(distPath));
app.use((req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Local server + CSM proxy listening on http://0.0.0.0:${PORT}`);
});
