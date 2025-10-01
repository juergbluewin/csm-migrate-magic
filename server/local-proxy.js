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
      const loginXml = `<?xml version="1.0" encoding="UTF-8"?>
<ns1:loginRequest xmlns:ns1="csm">
  <ns1:protVersion>1.0</ns1:protVersion>
  <ns1:username>${username}</ns1:username>
  <ns1:password>${password}</ns1:password>
</ns1:loginRequest>`;

      const start = Date.now();
      const response = await axios.post(`${baseUrl}/login`, loginXml, {
        headers: { 'Content-Type': 'application/xml', 'Accept': 'application/xml' },
        httpsAgent: agent,
        timeout: 20000,
        responseType: 'text',
        validateStatus: () => true,
      });
      const duration = Date.now() - start;
      const setCookie = response.headers['set-cookie'] ? response.headers['set-cookie'].join(', ') : undefined;

      console.log(`[${requestId}] <- CSM Response`, { status: response.status, ok: response.status >= 200 && response.status < 300, duration: `${duration}ms`, hasSetCookie: !!setCookie });

      return res.status(200).json({
        ok: response.status >= 200 && response.status < 300,
        status: response.status,
        statusText: response.statusText,
        body: response.data,
        headers: { 'set-cookie': setCookie },
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