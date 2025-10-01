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

app.post('/csm-proxy', async (req, res) => {
  const { action, ipAddress, username, password, verifyTls, endpoint, body, cookie } = req.body || {};
  const requestId = Math.random().toString(36).slice(2, 10);

  try {
    if (!ipAddress) return res.status(400).json({ error: 'ipAddress required' });

    const baseUrl = `https://${ipAddress}/nbi`;
    const agent = new https.Agent({ rejectUnauthorized: verifyTls === true });

    console.log(`[${requestId}] CSM Local Proxy ->`, { action, ipAddress, endpoint: endpoint || '/nbi/login', verifyTls, isPrivateIP: isPrivateIP(ipAddress) });

    if (action === 'login') {
      // Try multiple potential login endpoints and XML namespace variants
      const endpoints = [
        '/login',
        '/securityservice/login',
        '/auth/login',
        '/userservice/login'
      ];

      const variants = [
        // Cisco responses show xmlns "csm"; try default namespace with that literal value
        {
          name: 'default-ns-simple',
          xml: `<?xml version="1.0" encoding="UTF-8"?>\n<loginRequest xmlns="csm">\n  <username>${username}</username>\n  <password>${password}</password>\n</loginRequest>`,
          contentType: 'text/xml',
        },
        // Prefixed version using the same literal namespace value
        {
          name: 'prefixed-ns-simple',
          xml: `<?xml version="1.0" encoding="UTF-8"?>\n<ns1:loginRequest xmlns:ns1="csm">\n  <ns1:username>${username}</ns1:username>\n  <ns1:password>${password}</ns1:password>\n</ns1:loginRequest>`,
          contentType: 'text/xml',
        },
        // Some deployments require reqId first
        {
          name: 'default-ns-with-reqId',
          xml: `<?xml version="1.0" encoding="UTF-8"?>\n<loginRequest xmlns="csm">\n  <reqId>1</reqId>\n  <username>${username}</username>\n  <password>${password}</password>\n</loginRequest>`,
          contentType: 'text/xml',
        },
        // protVersion may be required and must precede others in some schemas
        {
          name: 'default-ns+protVersion',
          xml: `<?xml version="1.0" encoding="UTF-8"?>\n<loginRequest xmlns="csm">\n  <protVersion>1.0</protVersion>\n  <username>${username}</username>\n  <password>${password}</password>\n</loginRequest>`,
          contentType: 'text/xml',
        },
        // Try a plausible URI-style namespace
        {
          name: 'uri-ns-simple',
          xml: `<?xml version="1.0" encoding="UTF-8"?>\n<loginRequest xmlns="http://www.cisco.com/security/manager/nbi">\n  <username>${username}</username>\n  <password>${password}</password>\n</loginRequest>`,
          contentType: 'text/xml',
        },
        // Try root element without namespace
        {
          name: 'login-root-no-ns',
          xml: `<?xml version="1.0" encoding="UTF-8"?>\n<login>\n  <username>${username}</username>\n  <password>${password}</password>\n</login>`,
          contentType: 'text/xml',
        },
        // Capitalized element name
        {
          name: 'LoginRequest-capital',
          xml: `<?xml version="1.0" encoding="UTF-8"?>\n<LoginRequest>\n  <username>${username}</username>\n  <password>${password}</password>\n</LoginRequest>`,
          contentType: 'text/xml',
        },
      ];

      let lastResponse;
      for (const ep of endpoints) {
        for (const v of variants) {
          const start = Date.now();
          const url = `${baseUrl}${ep}`;
          const response = await axios.post(url, v.xml, {
            headers: { 'Content-Type': v.contentType, 'Accept': 'application/xml' },
            httpsAgent: agent,
            timeout: 20000,
            responseType: 'text',
            validateStatus: () => true,
          });
          const duration = Date.now() - start;
          const setCookie = response.headers['set-cookie'] ? response.headers['set-cookie'].join(', ') : undefined;
          console.log(`[${requestId}] <- CSM Response (${ep} | ${v.name})`, { status: response.status, ok: response.status >= 200 && response.status < 300, duration: `${duration}ms`, hasSetCookie: !!setCookie });
          lastResponse = { response, setCookie, variant: `${ep} | ${v.name}` };
          const bodyText = String(response.data || '');
          const validationError = /validation errors|Cannot find the declaration/i.test(bodyText);
          if (response.status >= 200 && response.status < 300 && setCookie) {
            return res.status(200).json({
              ok: true,
              status: response.status,
              statusText: response.statusText,
              body: response.data,
              headers: { 'set-cookie': setCookie },
              variant: `${ep} | ${v.name}`,
            });
          }
          // Retry on typical schema/404 responses
          if (response.status === 404 || validationError) {
            continue;
          } else {
            // non-schema error: stop trying more variants for this endpoint
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
          ...(cookie ? { 'Cookie': cookie } : {}),
        },
        httpsAgent: agent,
        timeout: 30000,
        responseType: 'text',
        validateStatus: () => true,
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
