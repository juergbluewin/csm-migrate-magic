interface CSMSession {
  cookie: string;
  baseUrl: string;
}

interface CSMLoginRequest {
  ipAddress: string;
  username: string;
  password: string;
  verifyTls: boolean;
}

interface CSMObjectQuery {
  policyObjectType: 'NetworkPolicyObject' | 'ServicePolicyObject';
  limit?: number;
  offset?: number;
}

interface CSMPolicyQuery {
  policyType: 'DeviceAccessRuleFirewallPolicy';
  policyName?: string;
  deviceGID?: string;
  limit?: number;
  offset?: number;
}

interface CSMCLIQuery {
  deviceIP: string;
  command: string;
  argument?: string;
}

export class CSMClient {
  private session: CSMSession | null = null;
  private localProxyUrl = `/csm-proxy`;

  private isPrivateIP(ip: string): boolean {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4) return false;
    
    // Check for private IP ranges
    if (parts[0] === 10) return true; // 10.0.0.0/8
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true; // 172.16.0.0/12
    if (parts[0] === 192 && parts[1] === 168) return true; // 192.168.0.0/16
    if (parts[0] === 127) return true; // 127.0.0.0/8 (localhost)
    
    return false;
  }

  async login({ ipAddress, username, password, verifyTls }: CSMLoginRequest): Promise<boolean> {
    const baseUrl = `https://${ipAddress}/nbi`;
    
    console.log('🔐 CSM Login (nur lokaler Proxy):', {
      ipAddress,
      username,
      verifyTls,
      timestamp: new Date().toISOString()
    });

    try {
      const requestStart = Date.now();
      const response = await fetch(this.localProxyUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'login',
          ipAddress,
          username,
          password,
          verifyTls,
        }),
      });
      const requestDuration = Date.now() - requestStart;
      console.log('📥 Lokaler Proxy Antwort:', {
        status: response.status,
        statusText: response.statusText,
        duration: `${requestDuration}ms`,
        ok: response.ok,
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Lokaler Proxy-Fehler: ${response.status} ${response.statusText}\n${text}`);
      }
      const result = await response.json();
      console.log('✅ Login-Response (lokaler Proxy):', {
        ok: result.ok,
        status: result.status,
        statusText: result.statusText,
        hasCookie: !!result.headers?.['set-cookie'] || !!result.headers?.['Set-Cookie'],
      });
      if (result.ok) {
        const setCookieHeader = result.headers?.['set-cookie'] || result.headers?.['Set-Cookie'];
        
        // Parse all cookies from Set-Cookie header(s)
        const cookies: string[] = [];
        if (setCookieHeader) {
          const cookieArray = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
          for (const cookieStr of cookieArray) {
            // Extract cookie name=value pairs (before first semicolon)
            const match = cookieStr.match(/^([^=]+)=([^;]+)/);
            if (match) {
              cookies.push(`${match[1]}=${match[2]}`);
            }
          }
        }
        
        if (cookies.length > 0) {
          this.session = {
            cookie: cookies.join('; '),
            baseUrl,
          };
          console.log('✅ Session erstellt:', { 
            cookieCount: cookies.length,
            cookiePreview: this.session.cookie.substring(0, 50) + '...'
          });
          return true;
        }
        throw new Error('Login erfolgreich, aber kein Session-Cookie erhalten');
      }
      throw new Error(`CSM Login fehlgeschlagen: ${result.status} ${result.statusText}\n${result.body || 'Keine Details'}`);
    } catch (error: any) {
      console.error('❌ Lokaler Proxy Login Fehler:', error);
      throw error;
    }
  }

  async getPolicyObjectsList({ policyObjectType, limit = 100, offset = 0 }: CSMObjectQuery) {
    if (!this.session) throw new Error('Nicht mit CSM verbunden');

    const requestXml = `<?xml version="1.0" encoding="UTF-8"?>
      <getPolicyObjectsListByTypeRequest>
        <policyObjectType>${policyObjectType}</policyObjectType>
        <limit>${limit}</limit>
        <offset>${offset}</offset>
      </getPolicyObjectsListByTypeRequest>`;

    const response = await fetch(this.localProxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'request',
        ipAddress: this.session.baseUrl.replace('https://', '').replace('/nbi', ''),
        endpoint: '/configservice/getPolicyObjectsListByType',
        body: requestXml,
        cookie: this.session.cookie,
      }),
    });
    if (!response.ok) throw new Error(`Lokaler Proxy-Fehler: ${response.status} ${response.statusText}`);
    const result = await response.json();
    if (!result.ok) throw new Error(`Fehler beim Abrufen der Policy-Objekte (${result.status}): ${result.statusText}`);
    return result.body;
  }

  async getPolicyObject(objectName: string, objectType: 'NetworkPolicyObject' | 'ServicePolicyObject') {
    if (!this.session) throw new Error('Not logged in to CSM');

    const wrapperTag = objectType === 'NetworkPolicyObject' ? 'networkPolicyObject' : 'servicePolicyObject';
    const requestXml = `<?xml version="1.0" encoding="UTF-8"?>
      <getPolicyObjectRequest>
        <${wrapperTag}>
          <name>${objectName}</name>
        </${wrapperTag}>
      </getPolicyObjectRequest>`;

    const response = await fetch(this.localProxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'request',
        ipAddress: this.session.baseUrl.replace('https://', '').replace('/nbi', ''),
        endpoint: '/configservice/getPolicyObject',
        body: requestXml,
        cookie: this.session.cookie,
      }),
    });
    if (!response.ok) throw new Error(`Lokaler Proxy-Fehler: ${response.status} ${response.statusText}`);
    const result = await response.json();
    if (!result.ok) throw new Error(`Failed to get policy object: ${result.statusText}`);
    return result.body;
  }

  async getPolicyConfigByName(policyName: string, policyType: string = 'DeviceAccessRuleFirewallPolicy') {
    if (!this.session) throw new Error('Not logged in to CSM');

    const requestXml = `<?xml version="1.0" encoding="UTF-8"?>
      <getPolicyConfigByNameRequest>
        <policyName>${policyName}</policyName>
        <policyType>${policyType}</policyType>
      </getPolicyConfigByNameRequest>`;

    const response = await fetch(this.localProxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'request',
        ipAddress: this.session.baseUrl.replace('https://', '').replace('/nbi', ''),
        endpoint: '/configservice/getPolicyConfigByName',
        body: requestXml,
        cookie: this.session.cookie,
      }),
    });
    if (!response.ok) throw new Error(`Lokaler Proxy-Fehler: ${response.status} ${response.statusText}`);
    const result = await response.json();
    if (!result.ok) throw new Error(`Failed to get policy config: ${result.statusText}`);
    return result.body;
  }

  async getPolicyConfigByDeviceGID(deviceGID: string, policyType: string = 'DeviceAccessRuleFirewallPolicy') {
    if (!this.session) throw new Error('Not logged in to CSM');

    const requestXml = `<?xml version="1.0" encoding="UTF-8"?>
      <getPolicyConfigByDeviceGIDRequest>
        <deviceGID>${deviceGID}</deviceGID>
        <policyType>${policyType}</policyType>
      </getPolicyConfigByDeviceGIDRequest>`;

    const response = await fetch(this.localProxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'request',
        ipAddress: this.session.baseUrl.replace('https://', '').replace('/nbi', ''),
        endpoint: '/configservice/getPolicyConfigByDeviceGID',
        body: requestXml,
        cookie: this.session.cookie,
      }),
    });
    if (!response.ok) throw new Error(`Lokaler Proxy-Fehler: ${response.status} ${response.statusText}`);
    const result = await response.json();
    if (!result.ok) throw new Error(`Failed to get policy config by device: ${result.statusText}`);
    return result.body;
  }

  async execDeviceReadOnlyCLICmds({ deviceIP, command, argument }: CSMCLIQuery) {
    if (!this.session) throw new Error('Not logged in to CSM');

    const requestXml = `<?xml version="1.0" encoding="UTF-8"?>
      <execDeviceReadOnlyCLICmdsRequest>
        <deviceIP>${deviceIP}</deviceIP>
        <cmd>${command}</cmd>
        ${argument ? `<argument>${argument}</argument>` : ''}
      </execDeviceReadOnlyCLICmdsRequest>`;

    const response = await fetch(this.localProxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'request',
        ipAddress: this.session.baseUrl.replace('https://', '').replace('/nbi', ''),
        endpoint: '/utilservice/execDeviceReadOnlyCLICmds',
        body: requestXml,
        cookie: this.session.cookie,
      }),
    });
    if (!response.ok) throw new Error(`Lokaler Proxy-Fehler: ${response.status} ${response.statusText}`);
    const result = await response.json();
    if (!result.ok) throw new Error(`Failed to execute CLI command: ${result.statusText}`);
    return result.body;
  }

  async logout() {
    if (!this.session) {
      return;
    }

    const ipAddress = this.session.baseUrl.replace('https://', '').replace('/nbi', '');

    try {
      console.log('🚪 Logout über lokalen Proxy');
      const response = await fetch(this.localProxyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'logout',
          ipAddress,
        }),
      });
      if (response.ok) {
        console.log('✅ Logout erfolgreich');
      }
    } catch (error) {
      console.warn('⚠️ Logout-Fehler (ignoriert):', error);
    } finally {
      this.session = null;
    }
  }
}

// XML Parser utilities
export class CSMXMLParser {
  static parseNetworkObjects(xmlData: string): any[] {
    // Simple XML parsing for network objects
    // In production, use a proper XML parser like DOMParser
    const objects: any[] = [];
    
    // This is a simplified parser - in production you'd use DOMParser
    // or a proper XML parsing library
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlData, 'text/xml');
    
    // Parse network objects from XML response
    const networkObjects = doc.querySelectorAll('networkPolicyObject');
    networkObjects.forEach((obj, index) => {
      const name = obj.querySelector('name')?.textContent || `object-${index}`;
      const kind = obj.querySelector('kind')?.textContent || 'host';
      const value = obj.querySelector('value')?.textContent || '';
      const description = obj.querySelector('description')?.textContent || '';
      
      objects.push({
        name,
        kind,
        value,
        description
      });
    });
    
    return objects;
  }

  static parseServiceObjects(xmlData: string): any[] {
    const objects: any[] = [];
    
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlData, 'text/xml');
    
    const serviceObjects = doc.querySelectorAll('servicePolicyObject');
    serviceObjects.forEach((obj, index) => {
      const name = obj.querySelector('name')?.textContent || `service-${index}`;
      const protocol = obj.querySelector('protocol')?.textContent || 'tcp';
      const ports = obj.querySelector('ports')?.textContent || '';
      const description = obj.querySelector('description')?.textContent || '';
      
      objects.push({
        name,
        protocol,
        ports,
        description
      });
    });
    
    return objects;
  }

  static parseAccessRules(xmlData: string): any[] {
    const rules: any[] = [];
    
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlData, 'text/xml');
    
    const accessRules = doc.querySelectorAll('accessRule');
    accessRules.forEach((rule, index) => {
      const name = rule.querySelector('name')?.textContent || `rule-${index}`;
      const action = rule.querySelector('action')?.textContent || 'permit';
      const source = Array.from(rule.querySelectorAll('source')).map(s => s.textContent || '');
      const destination = Array.from(rule.querySelectorAll('destination')).map(d => d.textContent || '');
      const services = Array.from(rule.querySelectorAll('service')).map(s => s.textContent || '');
      const disabled = rule.querySelector('disabled')?.textContent === 'true';
      const logging = rule.querySelector('logging')?.textContent || 'default';
      
      rules.push({
        policy: 'imported',
        position: index + 1,
        name,
        source,
        destination,
        services,
        action,
        disabled,
        logging
      });
    });
    
    return rules;
  }
}