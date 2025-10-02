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
  const jar = jarFor(ipAddress);
  
  if (hasSession(ipAddress, baseUrl)) {
    try {
      const logoutXml = '<?xml version="1.0" encoding="UTF-8"?>\n<csm:logoutRequest xmlns:csm="csm"/>';
      const cookies = cookieHeaderFor(ipAddress, `${baseUrl}/logout`);
      await axios.post(`${baseUrl}/logout`, logoutXml, {
        headers: {
          'Content-Type': 'application/xml',
          'Accept': 'application/xml',
          'User-Agent': 'curl/8.5.0',
          ...(cookies ? { 'Cookie': cookies } : {}),
        },
        httpsAgent: agent,
        timeout: 10000,
        validateStatus: () => true,
      });
    } catch (e) {
      console.log(`⚠️ Logout failed (ignored):`, e.message);
    }
  }

  // Cookie-Jar komplett leeren
  const allCookies = jar.getCookiesSync(baseUrl);
  for (const cookie of allCookies) {
    try {
      jar.setCookieSync(`${cookie.key}=; Max-Age=0; Path=${cookie.path}`, baseUrl);
    } catch {}
  }
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
function hasSession(ip, baseUrl) {
  try {
    const cookies = jarFor(ip).getCookiesSync(baseUrl);
    return cookies.some((c) => c.key === 'asCookie' && !c.isExpired());
  } catch {
    return false;
  }
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

      if (action === 'login') { return await withSingleLogin(ipAddress, async () => {
        const protocol = 'https';
        const port = 443;
        const baseUrl = `${protocol}://${ipAddress}:${port}/nbi`;
        const jar = jarFor(ipAddress);

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

        // Set-Cookie persistent in die Jar übernehmen
        const setCookieHeaders = response.headers['set-cookie'] || response.headers['Set-Cookie'] || [];
        const setCookies = Array.isArray(setCookieHeaders) ? setCookieHeaders : (setCookieHeaders ? [setCookieHeaders] : []);
        for (const c of setCookies) {
          try { jar.setCookieSync(c, baseUrl); } catch {}
        }

        const bodyText = String(response.data || '');
        const isLoginResponse = /<(?:csm:)?loginResponse[\s>]/i.test(bodyText);
        const hasAsCookie = setCookies.some(c => /^asCookie=/.test(c));

        if (response.status === 200 && (isLoginResponse || hasAsCookie)) {
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
      
      // Cookie aus Jar holen
      const cookieStr = cookieHeaderFor(ipAddress, fullUrl);

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

      // Set-Cookie aus jeder Antwort persistent in die Jar übernehmen
      const setCookieResp1 = response.headers['set-cookie'] || response.headers['Set-Cookie'] || [];
      const setCookiesArr1 = Array.isArray(setCookieResp1) ? setCookieResp1 : (setCookieResp1 ? [setCookieResp1] : []);
      if (setCookiesArr1.length > 0) {
        const jar = jarFor(ipAddress);
        for (const c of setCookiesArr1) {
          try { jar.setCookieSync(c, fullUrl); } catch {}
        }
      }

      // Bei 401: genau ein stiller Re-Login mit gemerktem Pfad/XML, danach ein Retry
      if (response.status === 401 && hint2.loginPath && hint2.loginXml) {
        console.log(`[${requestId}] 🔄 Got 401 - attempting silent re-login`);
        await withSingleLogin(ipAddress, async () => {
          // Erst alte Session sauber beenden
          const baseUrlForCleanup = `${protocol2}://${ipAddress}${port2}${hint2.basePath || ''}`;
          await cleanupSession(ipAddress, baseUrlForCleanup, agent);
          
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
          if (scArr.length > 0) {
            const jar = jarFor(ipAddress);
            for (const c of scArr) {
              try { jar.setCookieSync(c, `${protocol2}://${ipAddress}${port2}${hint2.basePath || ''}`); } catch {}
            }
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

      // Set-Cookie nach dem evtl. Retry nochmals übernehmen
      const setCookieResp2 = response.headers['set-cookie'] || response.headers['Set-Cookie'] || [];
      const setCookiesArr2 = Array.isArray(setCookieResp2) ? setCookieResp2 : (setCookieResp2 ? [setCookieResp2] : []);
      if (setCookiesArr2.length > 0) {
        const jar = jarFor(ipAddress);
        for (const c of setCookiesArr2) {
          try { jar.setCookieSync(c, fullUrl); } catch {}
        }
      }

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
