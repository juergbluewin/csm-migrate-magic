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
  private apiLoginUrl = '/api/login';
  private proxyUrl = '/csm-proxy';

  async login({ ipAddress, username, password, verifyTls }: CSMLoginRequest): Promise<boolean> {
    console.log('🔐 CSM Login via local proxy');
    
    const response = await fetch(this.apiLoginUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include', // Enable cookie handling
      body: JSON.stringify({ ipAddress, username, password, verifyTls })
    });
    
    const result = await response.json();
    
    // Check for successful login
    if (!result.ok || !response.ok) {
      const statusCode = result.status ?? response.status;
      const message = result.message ?? result.statusText ?? 'Unknown error';
      
      if (statusCode === 423) {
        throw new Error('CSM Session gesperrt (Code 29) - bitte warten und erneut versuchen');
      }
      if (statusCode === 401 || statusCode === 400) {
        throw new Error(`CSM Login fehlgeschlagen: ${message}`);
      }
      if (statusCode === 503) {
        throw new Error(`CSM NBI Service nicht verfügbar auf ${ipAddress}`);
      }
      throw new Error(`CSM Login fehlgeschlagen: ${statusCode} ${message}`);
    }
    
    // Session als Platzhalter - Cookie wird vom Browser automatisch verwaltet
    this.session = { cookie: '', baseUrl: `http://${ipAddress}:1741/nbi/v1` };
    console.log('✅ Login erfolgreich, Session-Cookie gesetzt');
    return true;
  }

  async getPolicyObjectsList({ policyObjectType, limit = 100, offset = 0 }: CSMObjectQuery) {
    if (!this.session) throw new Error('Nicht mit CSM verbunden');

    const requestXml = `<?xml version="1.0" encoding="UTF-8"?>
      <getPolicyObjectsListByTypeRequest>
        <policyObjectType>${policyObjectType}</policyObjectType>
        <limit>${limit}</limit>
        <offset>${offset}</offset>
      </getPolicyObjectsListByTypeRequest>`;

    const ipAddress = this.session.baseUrl.replace('https://', '').replace('/nbi', '');
    return this.request('/configservice/getPolicyObjectsListByType', requestXml);
  }

  private async request(endpoint: string, body: string) {
    if (!this.session) throw new Error('Nicht mit CSM verbunden');
    
    const ipAddress = this.session.baseUrl
      .replace('https://', '')
      .replace('http://', '')
      .replace(':1741', '')
      .replace('/nbi/v1', '')
      .replace('/nbi', '');
    
    const response = await fetch(this.proxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include', // Enable cookie handling
      body: JSON.stringify({ action: 'request', ipAddress, endpoint, body })
    });
    
    const result = await response.json();
    
    // Prüfe explizit auf ok:true
    if (result.ok !== true || !response.ok) {
      const statusCode = result.status ?? response.status;
      const statusText = result.statusText ?? response.statusText ?? 'Unknown error';
      
      if (statusCode === 423) {
        // Session-Lock (Code 29): Session lokal löschen
        this.session = null;
        throw new Error('CSM Session gesperrt (Code 29) - bitte erneut anmelden');
      }
      
      if (statusCode === 401) {
        // Unauthorized: Session ungültig
        this.session = null;
        throw new Error('CSM Session abgelaufen - bitte erneut anmelden');
      }

      if (statusCode === 503 || statusCode === 404) {
        throw new Error(`CSM NBI Service nicht verfügbar auf ${ipAddress}`);
      }
      
      throw new Error(`CSM Request fehlgeschlagen: ${statusCode} ${statusText}`);
    }
    
    return String(result.body || '');
  }

  async getPolicyObject(objectName: string, objectType: 'NetworkPolicyObject' | 'ServicePolicyObject') {
    const wrapperTag = objectType === 'NetworkPolicyObject' ? 'networkPolicyObject' : 'servicePolicyObject';
    const requestXml = `<?xml version="1.0" encoding="UTF-8"?>
      <getPolicyObjectRequest>
        <${wrapperTag}>
          <name>${objectName}</name>
        </${wrapperTag}>
      </getPolicyObjectRequest>`;

    return this.request('/configservice/getPolicyObject', requestXml);
  }

  async getPolicyConfigByName(policyName: string, policyType: string = 'DeviceAccessRuleFirewallPolicy') {
    const requestXml = `<?xml version="1.0" encoding="UTF-8"?>
      <getPolicyConfigByNameRequest>
        <policyName>${policyName}</policyName>
        <policyType>${policyType}</policyType>
      </getPolicyConfigByNameRequest>`;

    return this.request('/configservice/getPolicyConfigByName', requestXml);
  }

  async getPolicyConfigByDeviceGID(deviceGID: string, policyType: string = 'DeviceAccessRuleFirewallPolicy') {
    const requestXml = `<?xml version="1.0" encoding="UTF-8"?>
      <getPolicyConfigByDeviceGIDRequest>
        <deviceGID>${deviceGID}</deviceGID>
        <policyType>${policyType}</policyType>
      </getPolicyConfigByDeviceGIDRequest>`;

    return this.request('/configservice/getPolicyConfigByDeviceGID', requestXml);
  }

  async execDeviceReadOnlyCLICmds({ deviceIP, command, argument }: CSMCLIQuery) {
    const requestXml = `<?xml version="1.0" encoding="UTF-8"?>
      <execDeviceReadOnlyCLICmdsRequest>
        <deviceIP>${deviceIP}</deviceIP>
        <cmd>${command}</cmd>
        ${argument ? `<argument>${argument}</argument>` : ''}
      </execDeviceReadOnlyCLICmdsRequest>`;

    return this.request('/utilservice/execDeviceReadOnlyCLICmds', requestXml);
  }

  async logout() {
    if (!this.session) return;
    
    const ipAddress = this.session.baseUrl
      .replace('https://', '')
      .replace('http://', '')
      .replace(':1741', '')
      .replace('/nbi/v1', '')
      .replace('/nbi', '');
    
    try {
      const response = await fetch(this.proxyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include', // Enable cookie handling
        body: JSON.stringify({ action: 'logout', ipAddress })
      });
      
      const result = await response.json();
      if (result.ok !== true) {
        console.warn('⚠️ Logout-Warnung:', result.statusText);
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