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
  private directMode: boolean = false;

  setDirectMode(enabled: boolean) {
    this.directMode = enabled;
    console.log(`🔧 CSM Client Mode: ${enabled ? 'DIRECT (lokales Netzwerk)' : 'PROXY (über Cloud)'}`);
  }

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
    
    console.log('🔐 CSM Login Versuch:', {
      ipAddress,
      username,
      verifyTls,
      mode: this.directMode ? 'DIRECT' : 'PROXY',
      isPrivateIP: this.isPrivateIP(ipAddress),
      timestamp: new Date().toISOString()
    });

    // DIREKTER MODUS: Browser -> CSM (lokales Netzwerk)
    if (this.directMode) {
      console.log('🎯 Direkter Modus: Verbinde direkt zum CSM im lokalen Netzwerk');
      
      const loginXml = `<?xml version="1.0" encoding="UTF-8"?>
        <loginRequest>
          <username>${username}</username>
          <password>${password}</password>
        </loginRequest>`;

      try {
        const requestStart = Date.now();
        const response = await fetch(`${baseUrl}/login`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/xml',
            'Accept': 'application/xml',
          },
          body: loginXml,
        });

        const requestDuration = Date.now() - requestStart;
        const responseText = await response.text();
        
        console.log('📥 CSM Direktantwort:', {
          status: response.status,
          statusText: response.statusText,
          duration: `${requestDuration}ms`,
          ok: response.ok
        });

        if (response.ok) {
          const setCookieHeader = response.headers.get('set-cookie');
          const sessionCookie = setCookieHeader?.match(/asCookie=([^;]+)/)?.[1];
          
          if (sessionCookie) {
            this.session = {
              cookie: `asCookie=${sessionCookie}`,
              baseUrl
            };
            console.log('✅ CSM Login erfolgreich (direkter Modus)!');
            return true;
          } else {
            console.error('❌ Kein Session-Cookie in der Antwort gefunden');
            throw new Error('Login erfolgreich, aber kein Session-Cookie erhalten');
          }
        }
        
        throw new Error(`CSM Login fehlgeschlagen: ${response.status} ${response.statusText}\n${responseText}`);
        
      } catch (error: any) {
        console.error('❌ Direkter CSM Login Fehler:', error);
        
        if (error.name === 'TypeError' && error.message.includes('Failed to fetch')) {
          throw new Error(
            `Direktverbindung zu ${ipAddress} fehlgeschlagen.\n\n` +
            `Mögliche Ursachen:\n` +
            `- CSM-Server ist nicht erreichbar\n` +
            `- Falsche IP-Adresse\n` +
            `- CORS nicht konfiguriert auf CSM\n` +
            `- Netzwerkproblem\n\n` +
            `Tipp: Überprüfen Sie die Browser-Konsole für CORS-Fehler`
          );
        }
        
        throw error;
      }
    }

    // PROXY MODUS: Browser -> Cloud Proxy -> CSM
    console.log('☁️ Proxy Modus: Verbinde über Cloud-Proxy');
    
    // Warnung bei privaten IP-Adressen im Proxy-Modus
    if (this.isPrivateIP(ipAddress)) {
      console.warn('⚠️ WARNUNG: Private IP-Adresse im Proxy-Modus!', {
        ipAddress,
        message: 'Der Cloud-Proxy kann private IP-Adressen nicht erreichen.',
        suggestion: 'Aktivieren Sie den "Direkten Modus" für lokale Netzwerk-Verbindungen.'
      });
    }
    
    try {
      console.log('📤 Sende Login-Request an Proxy...');
      
      const requestStart = Date.now();
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

      const requestDuration = Date.now() - requestStart;
      console.log('📥 Proxy-Antwort erhalten:', {
        status: response.status,
        statusText: response.statusText,
        duration: `${requestDuration}ms`,
        ok: response.ok
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorDetails;
        try {
          errorDetails = JSON.parse(errorText);
        } catch {
          errorDetails = { message: errorText };
        }

        console.error('❌ Proxy-Fehler Details:', {
          status: response.status,
          statusText: response.statusText,
          errorDetails,
          isPrivateIP: this.isPrivateIP(ipAddress)
        });

        // Spezifische Fehlermeldungen
        if (errorDetails.error?.includes('Connection timed out') || errorDetails.error?.includes('ETIMEDOUT')) {
          if (this.isPrivateIP(ipAddress)) {
            throw new Error(
              `Verbindung nicht möglich: Private IP-Adresse (${ipAddress})\n\n` +
              `Der Cloud-Proxy kann keine privaten Netzwerk-IPs erreichen.\n\n` +
              `Lösungen:\n` +
              `1. Verwenden Sie die öffentliche IP-Adresse des CSM-Servers\n` +
              `2. Verwenden Sie einen DNS-Namen statt einer IP\n` +
              `3. Führen Sie die Anwendung lokal aus (Docker)`
            );
          } else {
            throw new Error(
              `Verbindungs-Timeout zu ${ipAddress}\n\n` +
              `Mögliche Ursachen:\n` +
              `- CSM-Server ist nicht erreichbar\n` +
              `- Firewall blockiert die Verbindung\n` +
              `- Falsche IP-Adresse oder Port\n` +
              `- CSM-Server ist nicht gestartet`
            );
          }
        }

        throw new Error(`Proxy-Fehler: ${response.status} ${response.statusText}\n${JSON.stringify(errorDetails, null, 2)}`);
      }

      const result = await response.json();
      
      console.log('✅ Login-Response Details:', {
        ok: result.ok,
        status: result.status,
        statusText: result.statusText,
        hasCookie: !!result.headers?.['set-cookie'] || !!result.headers?.['Set-Cookie']
      });

      if (result.ok) {
        const setCookieHeader = result.headers['set-cookie'] || result.headers['Set-Cookie'];
        const sessionCookie = setCookieHeader?.match(/asCookie=([^;]+)/)?.[1];
        
        if (sessionCookie) {
          this.session = {
            cookie: `asCookie=${sessionCookie}`,
            baseUrl
          };
          console.log('✅ CSM Login erfolgreich!', {
            hasSession: !!this.session,
            baseUrl
          });
          return true;
        } else {
          console.error('❌ Kein Session-Cookie in der Antwort gefunden', {
            headers: result.headers
          });
        }
      }
      
      const errorMsg = `Login fehlgeschlagen: ${result.status} ${result.statusText}`;
      console.error('❌', errorMsg, {
        body: result.body
      });
      
      throw new Error(`${errorMsg}\n${result.body || 'Keine Details verfügbar'}`);
      
    } catch (error: any) {
      console.error('❌ CSM Login error:', error);
      
      if (error.name === 'TypeError' && error.message.includes('Failed to fetch')) {
        throw new Error(
          'Netzwerkfehler: CSM Proxy nicht erreichbar.\n\n' +
          'Überprüfen Sie:\n' +
          '- Internetverbindung ist aktiv\n' +
          '- Lovable Cloud Backend ist erreichbar\n' +
          '- Browser-Konsole für weitere Details'
        );
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

    if (this.directMode) {
      const response = await fetch(`${this.session.baseUrl}/configservice/getPolicyObjectsListByType`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/xml',
          'Accept': 'application/xml',
          'Cookie': this.session.cookie,
        },
        body: requestXml,
      });

      if (!response.ok) {
        throw new Error(`CSM API Fehler: ${response.status} ${response.statusText}`);
      }

      return await response.text();
    }

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

    if (this.directMode) {
      const response = await fetch(`${this.session.baseUrl}/configservice/getPolicyObject`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/xml',
          'Accept': 'application/xml',
          'Cookie': this.session.cookie,
        },
        body: requestXml,
      });

      if (!response.ok) {
        throw new Error(`CSM API Fehler: ${response.status} ${response.statusText}`);
      }

      return await response.text();
    }

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

    if (this.directMode) {
      const response = await fetch(`${this.session.baseUrl}/configservice/getPolicyConfigByName`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/xml',
          'Accept': 'application/xml',
          'Cookie': this.session.cookie,
        },
        body: requestXml,
      });

      if (!response.ok) {
        throw new Error(`CSM API Fehler: ${response.status} ${response.statusText}`);
      }

      return await response.text();
    }

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

    if (this.directMode) {
      const response = await fetch(`${this.session.baseUrl}/configservice/getPolicyConfigByDeviceGID`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/xml',
          'Accept': 'application/xml',
          'Cookie': this.session.cookie,
        },
        body: requestXml,
      });

      if (!response.ok) {
        throw new Error(`CSM API Fehler: ${response.status} ${response.statusText}`);
      }

      return await response.text();
    }

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

    if (this.directMode) {
      const response = await fetch(`${this.session.baseUrl}/utilservice/execDeviceReadOnlyCLICmds`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/xml',
          'Accept': 'application/xml',
          'Cookie': this.session.cookie,
        },
        body: requestXml,
      });

      if (!response.ok) {
        throw new Error(`CSM API Fehler: ${response.status} ${response.statusText}`);
      }

      return await response.text();
    }

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