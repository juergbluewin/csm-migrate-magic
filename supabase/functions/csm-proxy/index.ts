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

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, ipAddress, username, password, verifyTls, endpoint, body, cookie }: ProxyRequest = await req.json();
    
    console.log(`CSM Proxy: ${action} to ${ipAddress}${endpoint || '/nbi/login'}`);

    if (action === 'login') {
      const loginXml = `<?xml version="1.0" encoding="UTF-8"?>
        <loginRequest>
          <username>${username}</username>
          <password>${password}</password>
        </loginRequest>`;

      const baseUrl = `https://${ipAddress}/nbi`;
      
      const response = await fetch(`${baseUrl}/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/xml',
          'Accept': 'application/xml',
        },
        body: loginXml,
      });

      const responseText = await response.text();
      const headers = Object.fromEntries(response.headers.entries());
      
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
      
      const response = await fetch(fullUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/xml',
          'Accept': 'application/xml',
          ...(cookie ? { 'Cookie': cookie } : {}),
        },
        body: body,
      });

      const responseText = await response.text();
      
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
    console.error('CSM Proxy error:', error);
    return new Response(JSON.stringify({ 
      error: error.message || 'Internal server error',
      details: error.toString()
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
