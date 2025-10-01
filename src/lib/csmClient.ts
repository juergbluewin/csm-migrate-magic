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
  private proxyUrl = `https://wlupuoyuccrwvfpabvli.supabase.co/functions/v1/csm-proxy`;

  async login({ ipAddress, username, password, verifyTls }: CSMLoginRequest): Promise<boolean> {
    const baseUrl = `https://${ipAddress}/nbi`;
    
    try {
      const response = await fetch(this.proxyUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'login',
          ipAddress,
          username,
          password,
          verifyTls
        })
      });

      if (!response.ok) {
        throw new Error(`Proxy-Fehler: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      
      if (result.ok) {
        const setCookieHeader = result.headers['set-cookie'] || result.headers['Set-Cookie'];
        const sessionCookie = setCookieHeader?.match(/asCookie=([^;]+)/)?.[1];
        
        if (sessionCookie) {
          this.session = {
            cookie: `asCookie=${sessionCookie}`,
            baseUrl
          };
          return true;
        }
      }
      
      throw new Error(`Login fehlgeschlagen: ${result.status} ${result.statusText}. ${result.body}`);
      
    } catch (error: any) {
      console.error('CSM Login error:', error);
      
      if (error.name === 'TypeError' && error.message.includes('Failed to fetch')) {
        throw new Error('Netzwerkfehler: CSM Proxy nicht erreichbar. Überprüfen Sie:\n' +
          '- Internetverbindung ist aktiv\n' +
          '- Lovable Cloud Backend ist erreichbar');
      }
      
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

    try {
      const response = await fetch(this.proxyUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'request',
          ipAddress: this.session.baseUrl.replace('https://', '').replace('/nbi', ''),
          endpoint: '/configservice/getPolicyObjectsListByType',
          body: requestXml,
          cookie: this.session.cookie
        })
      });

      if (!response.ok) {
        throw new Error(`Proxy-Fehler: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      
      if (!result.ok) {
        throw new Error(`Fehler beim Abrufen der Policy-Objekte (${result.status}): ${result.statusText}`);
      }

      return result.body;
    } catch (error: any) {
      if (error.name === 'TypeError' && error.message.includes('Failed to fetch')) {
        throw new Error('Netzwerkfehler beim Abrufen der Policy-Objekte. CSM-Verbindung unterbrochen.');
      }
      throw error;
    }
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

    const response = await fetch(this.proxyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'request',
        ipAddress: this.session.baseUrl.replace('https://', '').replace('/nbi', ''),
        endpoint: '/configservice/getPolicyObject',
        body: requestXml,
        cookie: this.session.cookie
      })
    });

    if (!response.ok) {
      throw new Error(`Proxy-Fehler: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    if (!result.ok) {
      throw new Error(`Failed to get policy object: ${result.statusText}`);
    }

    return result.body;
  }

  async getPolicyConfigByName(policyName: string, policyType: string = 'DeviceAccessRuleFirewallPolicy') {
    if (!this.session) throw new Error('Not logged in to CSM');

    const requestXml = `<?xml version="1.0" encoding="UTF-8"?>
      <getPolicyConfigByNameRequest>
        <policyName>${policyName}</policyName>
        <policyType>${policyType}</policyType>
      </getPolicyConfigByNameRequest>`;

    const response = await fetch(this.proxyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'request',
        ipAddress: this.session.baseUrl.replace('https://', '').replace('/nbi', ''),
        endpoint: '/configservice/getPolicyConfigByName',
        body: requestXml,
        cookie: this.session.cookie
      })
    });

    if (!response.ok) {
      throw new Error(`Proxy-Fehler: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    if (!result.ok) {
      throw new Error(`Failed to get policy config: ${result.statusText}`);
    }

    return result.body;
  }

  async getPolicyConfigByDeviceGID(deviceGID: string, policyType: string = 'DeviceAccessRuleFirewallPolicy') {
    if (!this.session) throw new Error('Not logged in to CSM');

    const requestXml = `<?xml version="1.0" encoding="UTF-8"?>
      <getPolicyConfigByDeviceGIDRequest>
        <deviceGID>${deviceGID}</deviceGID>
        <policyType>${policyType}</policyType>
      </getPolicyConfigByDeviceGIDRequest>`;

    const response = await fetch(this.proxyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'request',
        ipAddress: this.session.baseUrl.replace('https://', '').replace('/nbi', ''),
        endpoint: '/configservice/getPolicyConfigByDeviceGID',
        body: requestXml,
        cookie: this.session.cookie
      })
    });

    if (!response.ok) {
      throw new Error(`Proxy-Fehler: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    if (!result.ok) {
      throw new Error(`Failed to get policy config by device: ${result.statusText}`);
    }

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

    const response = await fetch(this.proxyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'request',
        ipAddress: this.session.baseUrl.replace('https://', '').replace('/nbi', ''),
        endpoint: '/utilservice/execDeviceReadOnlyCLICmds',
        body: requestXml,
        cookie: this.session.cookie
      })
    });

    if (!response.ok) {
      throw new Error(`Proxy-Fehler: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    if (!result.ok) {
      throw new Error(`Failed to execute CLI command: ${result.statusText}`);
    }

    return result.body;
  }

  logout() {
    this.session = null;
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