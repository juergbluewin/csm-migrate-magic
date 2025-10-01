import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ProxyRequest {
  action: 'login' | 'request';
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

    if (action === 'login') {
      const loginXml = `<?xml version="1.0" encoding="UTF-8"?>
        <loginRequest>
          <username>${username}</username>
          <password>${password}</password>
        </loginRequest>`;

      const baseUrl = `https://${ipAddress}/nbi`;
      
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
      const baseUrl = `https://${ipAddress}/nbi`;
      const fullUrl = endpoint.startsWith('http') ? endpoint : `${baseUrl}${endpoint}`;
      
      console.log(`[${requestId}] 📤 CSM API Request to ${fullUrl}`);
      const fetchStart = Date.now();
      
      const response = await fetch(fullUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/xml',
          'Accept': 'application/xml',
          ...(cookie ? { 'Cookie': cookie } : {}),
        },
        body: body,
      });

      const fetchDuration = Date.now() - fetchStart;
      const responseText = await response.text();
      
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
