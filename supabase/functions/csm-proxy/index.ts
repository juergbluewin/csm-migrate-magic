import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Session-Speicher: IP -> { cookie, lastUsed }
const sessions = new Map<string, { cookie: string; lastUsed: number }>();

interface ProxyRequest {
  action: 'login' | 'request' | 'logout';
  ipAddress: string;
  username?: string;
  password?: string;
  verifyTls?: boolean;
  endpoint?: string;
  body?: string;
  cookie?: string;
}

function isPrivateIP(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4) return false;
  
  if (parts[0] === 10) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 127) return true;
  
  return false;
}

function hasSession(ip: string): boolean {
  const session = sessions.get(ip);
  if (!session) return false;
  // Session-Timeout: 30 Minuten
  return Date.now() - session.lastUsed < 30 * 60 * 1000;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, ipAddress, username, password, verifyTls, endpoint, body, cookie }: ProxyRequest = await req.json();
    
    const requestId = crypto.randomUUID().substring(0, 8);
    console.log(`[${requestId}] 📥 CSM Proxy Request:`, {
      action,
      ipAddress,
      endpoint: endpoint || '/nbi/login',
      isPrivateIP: isPrivateIP(ipAddress),
      timestamp: new Date().toISOString()
    });

    // Warnung bei privaten IPs
    if (isPrivateIP(ipAddress)) {
      console.warn(`[${requestId}] ⚠️ Private IP detected: ${ipAddress} - Connection will likely fail from cloud environment`);
    }

    if (action === 'logout') {
      const protocol = verifyTls ? 'https' : 'http';
      const port = verifyTls ? '' : ':1741';
      const baseUrl = `${protocol}://${ipAddress}${port}/nbi`;
      const logoutXml = `<?xml version="1.0" encoding="UTF-8"?>
<csm:logoutRequest xmlns:csm="csm"/>`;
      
      console.log(`[${requestId}] 🚪 Attempting CSM logout to ${baseUrl}/logout`);
      
      const session = sessions.get(ipAddress);
      try {
        const response = await fetch(`${baseUrl}/logout`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/xml',
            'Accept': 'application/xml',
            ...(session?.cookie ? { 'Cookie': session.cookie } : {}),
          },
          body: logoutXml,
        });

        const responseText = await response.text();
        sessions.delete(ipAddress);
        
        return new Response(JSON.stringify({
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          body: responseText,
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        });
      } catch (error: any) {
        console.log(`[${requestId}] ⚠️ Logout failed (ignored):`, error.message);
        sessions.delete(ipAddress);
        return new Response(JSON.stringify({
          ok: true,
          status: 200,
          statusText: 'Logout attempted',
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        });
      }
    }

    if (action === 'login') {
      // Wenn Session existiert und gültig, keinen neuen Login
      if (hasSession(ipAddress)) {
        const session = sessions.get(ipAddress)!;
        console.log(`[${requestId}] ✅ Session bereits vorhanden, kein neuer Login nötig`);
        return new Response(JSON.stringify({
          ok: true,
          status: 200,
          statusText: 'OK',
          body: '<?xml version="1.0" encoding="UTF-8"?><csm:loginResponse xmlns:csm="csm"><protVersion>1.0</protVersion></csm:loginResponse>',
          headers: { 'set-cookie': [`asCookie=${session.cookie}; Path=/; HttpOnly`] },
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        });
      }

      const loginXml = `<?xml version="1.0" encoding="UTF-8"?>
<loginRequest xmlns="csm">
  <protVersion>2.0</protVersion>
  <reqId>${requestId}</reqId>
  <username>${username}</username>
  <password>${password}</password>
</loginRequest>`;

      const protocol = verifyTls ? 'https' : 'http';
      const port = verifyTls ? '' : ':1741';
      const baseUrl = `${protocol}://${ipAddress}${port}/nbi`;
      
      console.log(`[${requestId}] 🔐 Attempting CSM login to ${baseUrl}/login`);
      const fetchStart = Date.now();
      
      const response = await fetch(`${baseUrl}/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/xml',
          'Accept': 'application/xml',
        },
        body: loginXml,
      });

      const fetchDuration = Date.now() - fetchStart;
      const responseText = await response.text();
      const headers = Object.fromEntries(response.headers.entries());
      
      console.log(`[${requestId}] ✅ CSM Response:`, {
        status: response.status,
        ok: response.ok,
        duration: `${fetchDuration}ms`,
        hasSetCookie: !!headers['set-cookie']
      });

      // Cookie zusammenführen und speichern
      const setCookieHeader = headers['set-cookie'];
      if (setCookieHeader && response.ok) {
        const cookieParts = [];
        const cookies = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
        for (const c of cookies) {
          const match = /^([^=]+)=([^;]+)/.exec(c);
          if (match) cookieParts.push(`${match[1]}=${match[2]}`);
        }
        const mergedCookie = cookieParts.join('; ');
        sessions.set(ipAddress, { cookie: mergedCookie, lastUsed: Date.now() });
      }

      // Bei Error Code 29: logout, warten, retry
      if (/<error><code>29<\/code>/i.test(responseText)) {
        console.log(`[${requestId}] ⚠️ Error Code 29 detected - attempting cleanup and retry`);
        
        // Logout
        const logoutXml = `<?xml version="1.0" encoding="UTF-8"?><csm:logoutRequest xmlns:csm="csm"/>`;
        try {
          await fetch(`${baseUrl}/logout`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/xml', 'Accept': 'application/xml' },
            body: logoutXml,
          });
        } catch {}
        
        sessions.delete(ipAddress);
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Retry login
        const retryResponse = await fetch(`${baseUrl}/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/xml', 'Accept': 'application/xml' },
          body: loginXml,
        });
        const retryText = await retryResponse.text();
        const retryHeaders = Object.fromEntries(retryResponse.headers.entries());
        
        if (retryResponse.ok) {
          const retryCookie = retryHeaders['set-cookie'];
          if (retryCookie) {
            const cookieParts = [];
            const cookies = Array.isArray(retryCookie) ? retryCookie : [retryCookie];
            for (const c of cookies) {
              const match = /^([^=]+)=([^;]+)/.exec(c);
              if (match) cookieParts.push(`${match[1]}=${match[2]}`);
            }
            const mergedCookie = cookieParts.join('; ');
            sessions.set(ipAddress, { cookie: mergedCookie, lastUsed: Date.now() });
          }
        }
        
        return new Response(JSON.stringify({
          ok: retryResponse.ok,
          status: retryResponse.status,
          statusText: retryResponse.statusText,
          body: retryText,
          headers: retryHeaders,
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        });
      }
      
      return new Response(JSON.stringify({
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        body: responseText,
        headers: headers,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    if (action === 'request' && endpoint) {
      const protocol = verifyTls ? 'https' : 'http';
      const port = verifyTls ? '' : ':1741';
      const baseUrl = `${protocol}://${ipAddress}${port}/nbi`;
      const fullUrl = endpoint.startsWith('http') ? endpoint : `${baseUrl}${endpoint}`;
      
      console.log(`[${requestId}] 📤 CSM API Request to ${fullUrl}`);
      const fetchStart = Date.now();
      
      // Cookie aus Session holen
      const session = sessions.get(ipAddress);
      const cookieStr = session?.cookie || cookie || '';
      
      const response = await fetch(fullUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/xml',
          'Accept': 'application/xml',
          ...(cookieStr ? { 'Cookie': cookieStr } : {}),
        },
        body: body,
      });

      const fetchDuration = Date.now() - fetchStart;
      const responseText = await response.text();
      
      // Session-Timeout aktualisieren
      if (session) {
        session.lastUsed = Date.now();
        sessions.set(ipAddress, session);
      }

      // Bei Error Code 29: logout, warten, retry
      const hasCode29 = /<error><code>29<\/code>/i.test(responseText);
      if (hasCode29 || response.status === 401) {
        console.log(`[${requestId}] ⚠️ Got ${response.status} ${hasCode29 ? '(Code 29)' : ''} - attempting re-login`);
        
        // Logout
        const logoutXml = `<?xml version="1.0" encoding="UTF-8"?><csm:logoutRequest xmlns:csm="csm"/>`;
        try {
          await fetch(`${baseUrl}/logout`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/xml', 'Accept': 'application/xml', ...(cookieStr ? { 'Cookie': cookieStr } : {}) },
            body: logoutXml,
          });
        } catch {}
        
        sessions.delete(ipAddress);
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Re-login (falls Credentials vorhanden)
        // Hinweis: In Edge Function sind username/password nicht bei request-Action verfügbar
        // Daher nur Logout durchführen und Fehler zurückgeben
      }
      
      console.log(`[${requestId}] ✅ API Response:`, {
        status: response.status,
        ok: response.ok,
        duration: `${fetchDuration}ms`
      });
      
      return new Response(JSON.stringify({
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        body: responseText,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    return new Response(JSON.stringify({ error: 'Invalid action' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    const requestId = crypto.randomUUID().substring(0, 8);
    console.error(`[${requestId}] ❌ CSM Proxy error:`, {
      name: error.name,
      message: error.message,
      code: error.code,
      stack: error.stack
    });
    
    return new Response(JSON.stringify({ 
      error: error.message || 'Internal server error',
      details: error.toString(),
      code: error.code,
      requestId
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
