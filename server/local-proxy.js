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

app.post('/csm-proxy', async (req, res) => {
  const { action, ipAddress, username, password, verifyTls, endpoint, body, cookie } = req.body || {};
  const requestId = Math.random().toString(36).slice(2, 10);

  try {
    if (!ipAddress) return res.status(400).json({ error: 'ipAddress required' });

    const baseUrl = `https://${ipAddress}/nbi`;
    const agent = new https.Agent({ rejectUnauthorized: verifyTls === true });

    console.log(`[${requestId}] CSM Local Proxy ->`, { action, ipAddress, endpoint: endpoint || '/nbi/login', verifyTls, isPrivateIP: isPrivateIP(ipAddress) });

      if (action === 'login') {
        // Warm-up: GET /nbi/ to obtain initial cookies (e.g., asCookie) some CSM setups set on first touch
        try {
          const warm = await axios.get(`${baseUrl}/`, {
            headers: {
              'User-Agent': 'curl/8.5.0',
              'Accept': 'text/html,application/xml;q=0.9,*/*;q=0.8',
            },
            httpsAgent: agent,
            timeout: 15000,
            validateStatus: () => true,
            maxRedirects: 0,
            proxy: false,
          });
          const warmSetCookie = warm.headers['set-cookie'];
          const warmCookies = warmSetCookie ? (Array.isArray(warmSetCookie) ? warmSetCookie : [warmSetCookie]) : [];
          if (warmCookies.length > 0) {
            console.log(`[${requestId}] Warm-up /nbi/ cookies`, { cookieCount: warmCookies.length });
            const asCookieHeader = warmCookies.find(c => /^asCookie=/.test(c));
            if (asCookieHeader) {
              try {
                const asCookiePair = asCookieHeader.split(';')[0];
                const canonicalLoginXml = `<?xml version="1.0" encoding="UTF-8"?>\n<loginRequest xmlns="http://www.cisco.com/security/manager/nbi">\n  <protVersion>1.0</protVersion>\n  <username>${username}</username>\n  <password>${password}</password>\n</loginRequest>`;
                const secResp = await axios.post(`${baseUrl}/securityservice/login`, canonicalLoginXml, {
                  headers: {
                    'Content-Type': 'text/xml; charset=UTF-8',
                    'Accept': 'application/xml',
                    'User-Agent': 'curl/8.5.0',
                    'Cookie': asCookiePair,
                  },
                  httpsAgent: agent,
                  timeout: 30000,
                  responseType: 'text',
                  validateStatus: () => true,
                  maxRedirects: 0,
                  proxy: false,
                });
                const secSetCookieHeaders = secResp.headers['set-cookie'];
                const secSetCookie = secSetCookieHeaders ? (Array.isArray(secSetCookieHeaders) ? secSetCookieHeaders : [secSetCookieHeaders]) : [];
                const secIsLoginResponse = /<\s*loginresponse[\s>]/i.test(String(secResp.data || ''));
                console.log(`[${requestId}] Warm 2-step /securityservice/login`, { status: secResp.status, hasSetCookie: secSetCookie.length > 0, secIsLoginResponse });
                if (secSetCookie.length > 0 && secIsLoginResponse) {
                  loginHints.set(ipAddress, { ep: '/securityservice/login', variantName: 'warmup-2-step' });
                  return res.status(200).json({
                    ok: true,
                    status: secResp.status,
                    statusText: secResp.statusText,
                    body: secResp.data,
                    headers: { 'set-cookie': [...warmCookies, ...secSetCookie] },
                    variant: `warmup -> /securityservice/login`,
                  });
                }
              } catch (e) {
                console.log(`[${requestId}] Warm 2-step failed`, e?.message || e);
              }
            }
          }
        } catch (e) {
          console.log(`[${requestId}] Warm-up skipped`, e?.message || e);
        }

        // Prioritize /login first (matches working Python example); try with and without trailing slash
        const endpoints = [
          '/login', '/login/',
          '/securityservice/login', '/securityservice/login/',
          '/auth/login', '/auth/login/',
          '/userservice/login', '/userservice/login/'
        ];

      const variants = [
        // EXACT working format from Python example with prefixed csm namespace + heartbeatRequested
        {
          name: 'csm-prefix+protVersion+reqId+heartbeat',
          xml: `<?xml version="1.0" encoding="UTF-8"?>\n<csm:loginRequest xmlns:csm="csm">\n  <protVersion>1.0</protVersion>\n  <reqId>1</reqId>\n  <username>${username}</username>\n  <password>${password}</password>\n  <heartbeatRequested>false</heartbeatRequested>\n</csm:loginRequest>`,
          contentType: 'text/xml',
        },
        // Same but without namespace prefix (default namespace)
        {
          name: 'csm-default+protVersion+reqId+heartbeat',
          xml: `<?xml version="1.0" encoding="UTF-8"?>\n<loginRequest xmlns="csm">\n  <protVersion>1.0</protVersion>\n  <reqId>1</reqId>\n  <username>${username}</username>\n  <password>${password}</password>\n  <heartbeatRequested>false</heartbeatRequested>\n</loginRequest>`,
          contentType: 'text/xml',
        },
        // Try URI namespace with proper element ordering (protVersion first per Cisco schema)
        {
          name: 'uri-ns-protVersion-first',
          xml: `<?xml version="1.0" encoding="UTF-8"?>\n<loginRequest xmlns="http://www.cisco.com/security/manager/nbi">\n  <protVersion>1.0</protVersion>\n  <username>${username}</username>\n  <password>${password}</password>\n</loginRequest>`,
          contentType: 'text/xml',
        },
        // URI namespace with prefixed form
        {
          name: 'uri-ns-prefixed',
          xml: `<?xml version="1.0" encoding="UTF-8"?>\n<ns1:loginRequest xmlns:ns1="http://www.cisco.com/security/manager/nbi">\n  <ns1:protVersion>1.0</ns1:protVersion>\n  <ns1:username>${username}</ns1:username>\n  <ns1:password>${password}</ns1:password>\n</ns1:loginRequest>`,
          contentType: 'text/xml',
        },
        // URI namespace with protVersion + serviceVersion + reqId
        {
          name: 'uri-ns-protVersion+serviceVersion+reqId',
          xml: `<?xml version="1.0" encoding="UTF-8"?>\n<loginRequest xmlns="http://www.cisco.com/security/manager/nbi">\n  <protVersion>1.0</protVersion>\n  <serviceVersion>2.0</serviceVersion>\n  <reqId>1</reqId>\n  <username>${username}</username>\n  <password>${password}</password>\n</loginRequest>`,
          contentType: 'text/xml',
        },
        // Literal "csm" namespace with protVersion
        {
          name: 'default-ns+protVersion',
          xml: `<?xml version="1.0" encoding="UTF-8"?>\n<loginRequest xmlns="csm">\n  <protVersion>1.0</protVersion>\n  <username>${username}</username>\n  <password>${password}</password>\n</loginRequest>`,
          contentType: 'text/xml',
        },
        // Literal "csm" namespace with protVersion + serviceVersion + reqId
        {
          name: 'default-ns+protVersion+serviceVersion+reqId',
          xml: `<?xml version="1.0" encoding="UTF-8"?>\n<loginRequest xmlns="csm">\n  <protVersion>1.0</protVersion>\n  <serviceVersion>2.0</serviceVersion>\n  <reqId>1</reqId>\n  <username>${username}</username>\n  <password>${password}</password>\n</loginRequest>`,
          contentType: 'text/xml',
        },
        // Literal "csm" namespace simple
        {
          name: 'default-ns-simple',
          xml: `<?xml version="1.0" encoding="UTF-8"?>\n<loginRequest xmlns="csm">\n  <username>${username}</username>\n  <password>${password}</password>\n</loginRequest>`,
          contentType: 'text/xml',
        },
        // Prefixed csm namespace
        {
          name: 'prefixed-ns-simple',
          xml: `<?xml version="1.0" encoding="UTF-8"?>\n<ns1:loginRequest xmlns:ns1="csm">\n  <ns1:username>${username}</ns1:username>\n  <ns1:password>${password}</ns1:password>\n</ns1:loginRequest>`,
          contentType: 'text/xml',
        },
        // With reqId
        {
          name: 'default-ns-with-reqId',
          xml: `<?xml version="1.0" encoding="UTF-8"?>\n<loginRequest xmlns="csm">\n  <reqId>1</reqId>\n  <username>${username}</username>\n  <password>${password}</password>\n</loginRequest>`,
          contentType: 'text/xml',
        },
        // URI namespace simple
        {
          name: 'uri-ns-simple',
          xml: `<?xml version="1.0" encoding="UTF-8"?>\n<loginRequest xmlns="http://www.cisco.com/security/manager/nbi">\n  <username>${username}</username>\n  <password>${password}</password>\n</loginRequest>`,
          contentType: 'text/xml',
        },
        // No namespace
        {
          name: 'login-root-no-ns',
          xml: `<?xml version="1.0" encoding="UTF-8"?>\n<login>\n  <username>${username}</username>\n  <password>${password}</password>\n</login>`,
          contentType: 'text/xml',
        },
        // Capitalized
        {
          name: 'LoginRequest-capital',
          xml: `<?xml version="1.0" encoding="UTF-8"?>\n<LoginRequest>\n  <username>${username}</username>\n  <password>${password}</password>\n</LoginRequest>`,
          contentType: 'text/xml',
        },
      ];

      let lastResponse;
      // Try hinted endpoint/variant first for this IP
      const hint = loginHints.get(ipAddress);
      if (hint) {
        try {
          const v = variants.find(x => x.name === hint.variantName);
          const ep = hint.ep;
          if (v && ep) {
            const start = Date.now();
            const url = `${baseUrl}${ep}`;
            const response = await axios.post(url, v.xml, {
              headers: { 
                'Content-Type': v.contentType, 
                'Accept': 'application/xml',
                'User-Agent': 'curl/8.5.0'
              },
              httpsAgent: agent,
              timeout: 30000,
              responseType: 'text',
              validateStatus: () => true,
              maxRedirects: 0,
              proxy: false,
            });
            const duration = Date.now() - start;
            const setCookieHeaders = response.headers['set-cookie'];
            const setCookie = setCookieHeaders
              ? (Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders])
              : undefined;
            const bodyText = String(response.data || '');
            const isLoginResponse = /<\s*loginresponse[\s>]/i.test(bodyText);
            console.log(`[${requestId}] <- CSM Response (HINT ${ep} | ${v.name})`, { 
              status: response.status, 
              ok: response.status >= 200 && response.status < 300, 
              duration: `${duration}ms`, 
              hasSetCookie: !!setCookie,
              cookieCount: Array.isArray(setCookie) ? setCookie.length : (setCookie ? 1 : 0),
              isLoginResponse,
            });
            if (setCookie && setCookie.length > 0 && isLoginResponse) {
              loginHints.set(ipAddress, { ep, variantName: v.name });
              return res.status(200).json({
                ok: true,
                status: response.status,
                statusText: response.statusText,
                body: response.data,
                headers: { 'set-cookie': setCookie },
                variant: `${ep} | ${v.name} (hint)`,
              });
            }
          }
        } catch (e) {
          console.log(`[${requestId}] Hint login attempt failed, falling back to full scan`);
        }
      }
      for (const ep of endpoints) {
        for (const v of variants) {
          const start = Date.now();
          const url = `${baseUrl}${ep}`;
          const response = await axios.post(url, v.xml, {
            headers: { 
              'Content-Type': v.contentType, 
              'Accept': 'application/xml',
              'User-Agent': 'curl/8.5.0'
            },
            httpsAgent: agent,
            timeout: 30000,
            responseType: 'text',
            validateStatus: () => true,
            maxRedirects: 0,
            proxy: false,
          });
          const duration = Date.now() - start;
          
          // Parse all Set-Cookie headers properly - keep as array!
          const setCookieHeaders = response.headers['set-cookie'];
          const setCookie = setCookieHeaders
            ? (Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders])
            : undefined;
          
          console.log(`[${requestId}] <- CSM Response (${ep} | ${v.name})`, { 
            status: response.status, 
            ok: response.status >= 200 && response.status < 300, 
            duration: `${duration}ms`, 
            hasSetCookie: !!setCookie,
            cookieCount: Array.isArray(setCookie) ? setCookie.length : (setCookie ? 1 : 0),
            cookies: setCookie
          });
          
          lastResponse = { response, setCookie, variant: `${ep} | ${v.name}` };
          const bodyText = String(response.data || '');
          const validationError = /validation errors|Cannot find the declaration/i.test(bodyText);
          const isLoginResponse = /<\s*loginresponse[\s>]/i.test(bodyText);

          // FAST-PATH: viele CSM akzeptieren 1-Step (/login) und setzen nur asCookie.
          // In diesem Fall Erfolg zurückgeben und 2-Step überspringen.
          const hasAsCookie = Array.isArray(setCookie) && setCookie.some(c => /^asCookie=/.test(c));
          if (!isLoginResponse && hasAsCookie) {
            loginHints.set(ipAddress, { ep, variantName: v.name + ' (asCookie-only)' });
            return res.status(200).json({
              ok: true,
              status: response.status,
              statusText: response.statusText,
              body: response.data,
              headers: { 'set-cookie': setCookie },
              variant: `${ep} | ${v.name} (asCookie-only)`,
            });
          }

          // bisheriger 2-Step nur noch, wenn kein asCookie vorhanden ist
          if (!isLoginResponse && setCookie && setCookie.length > 0 && !hasAsCookie) {
            const asCookieHeader = setCookie.find(c => /^asCookie=/.test(c));
            if (asCookieHeader) {
              try {
                const asCookiePair = asCookieHeader.split(';')[0];
                const canonicalLoginXml = `<?xml version="1.0" encoding="UTF-8"?>\n<loginRequest xmlns="http://www.cisco.com/security/manager/nbi">\n  <protVersion>1.0</protVersion>\n  <username>${username}</username>\n  <password>${password}</password>\n</loginRequest>`;
                const twoStepStart = Date.now();
                const secResp = await axios.post(`${baseUrl}/securityservice/login`, canonicalLoginXml, {
                  headers: {
                    'Content-Type': 'text/xml',
                    'Accept': 'application/xml',
                    'User-Agent': 'curl/8.5.0',
                    'Cookie': asCookiePair,
                  },
                  httpsAgent: agent,
                  timeout: 30000,
                  responseType: 'text',
                  validateStatus: () => true,
                  maxRedirects: 0,
                  proxy: false,
                });
                const twoStepDur = Date.now() - twoStepStart;
                const secSetCookieHeaders = secResp.headers['set-cookie'];
                const secSetCookie = secSetCookieHeaders
                  ? (Array.isArray(secSetCookieHeaders) ? secSetCookieHeaders : [secSetCookieHeaders])
                  : [];
                const secBodyText = String(secResp.data || '');
                const secIsLoginResponse = /<\s*loginresponse[\s>]/i.test(secBodyText);
                console.log(`[${requestId}] <- Two-step /securityservice/login`, {
                  status: secResp.status,
                  ok: secResp.status >= 200 && secResp.status < 300,
                  duration: `${twoStepDur}ms`,
                  hasSetCookie: secSetCookie.length > 0,
                  cookieCount: secSetCookie.length,
                  secIsLoginResponse
                });
                if (secSetCookie.length > 0 && secIsLoginResponse) {
                  loginHints.set(ipAddress, { ep: '/securityservice/login', variantName: 'uri-ns-protVersion-first (2-step)' });
                  return res.status(200).json({
                    ok: true,
                    status: secResp.status,
                    statusText: secResp.statusText,
                    body: secResp.data,
                    headers: { 'set-cookie': [...setCookie, ...secSetCookie] },
                    variant: `${ep} | ${v.name} + 2-step`,
                  });
                }
              } catch (e) {
                console.log(`[${requestId}] Two-step attempt failed:`, e?.message || e);
              }
            }
          }
          
          // Success only if we have a proper loginresponse and cookies
          if (setCookie && setCookie.length > 0 && isLoginResponse) {
            loginHints.set(ipAddress, { ep, variantName: v.name });
            return res.status(200).json({
              ok: true,
              status: response.status,
              statusText: response.statusText,
              body: response.data,
              headers: { 'set-cookie': setCookie },
              variant: `${ep} | ${v.name}`,
            });
          }
          
          // Retry on schema errors, 404, or any 401 (unauthorized)
          if (response.status === 404 || validationError || response.status === 401) {
            continue;
          } else {
            // Other error: stop trying more variants for this endpoint
            break;
          }
        }
      }

      // Return last attempt
      const { response, setCookie, variant } = lastResponse || {};
      return res.status(200).json({
        ok: response ? (response.status >= 200 && response.status < 300) : false,
        status: response?.status ?? 500,
        statusText: response?.statusText ?? 'No response',
        body: response?.data,
        headers: { 'set-cookie': setCookie },
        variant,
      });
    }

    if (action === 'request' && endpoint) {
      const fullUrl = endpoint.startsWith('http') ? endpoint : `${baseUrl}${endpoint}`;
      const start = Date.now();
      const response = await axios.post(fullUrl, body, {
        headers: {
          'Content-Type': 'application/xml',
          'Accept': 'application/xml',
          'User-Agent': 'curl/8.5.0',
          ...(cookie ? { 'Cookie': cookie } : {}),
        },
        httpsAgent: agent,
        timeout: 30000,
        responseType: 'text',
        validateStatus: () => true,
        maxRedirects: 0,
        proxy: false,
      });
      const duration = Date.now() - start;
      console.log(`[${requestId}] <- API Response`, { status: response.status, ok: response.status >= 200 && response.status < 300, duration: `${duration}ms` });

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

// Static hosting
const distPath = path.join(__dirname, '..', 'dist');
app.use(express.static(distPath));
app.use((req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Local server + CSM proxy listening on http://0.0.0.0:${PORT}`);
});
