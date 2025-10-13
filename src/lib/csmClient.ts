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
  private isLocal = import.meta.env.DEV;
  // Fallback to hardcoded values if env vars are not available in production
  private supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://wlupuoyuccrwvfpabvli.supabase.co';
  private supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndsdXB1b3l1Y2Nyd3ZmcGFidmxpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTgwNTcxMDMsImV4cCI6MjA3MzYzMzEwM30.Jp0oYNxRJPIEhzPFxxrVSVZ9er-etYE5GtDONfdjUPA';
  private functionUrl = `${this.supabaseUrl}/functions/v1/csm-proxy`;
  private apiLoginUrl = '/api/login'; // local dev
  private proxyUrl = '/csm-proxy'; // local dev

  async login({ ipAddress, username, password, verifyTls }: CSMLoginRequest): Promise<boolean> {
    console.log('🔐 CSM Login via local proxy', { 
      ipAddress, 
      verifyTls, 
      timestamp: new Date().toISOString() 
    });
    
    try {
      const isLocal = this.isLocal;
      const url = isLocal ? this.apiLoginUrl : this.functionUrl;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (!isLocal) {
        headers['apikey'] = this.supabaseKey;
        headers['Authorization'] = `Bearer ${this.supabaseKey}`;
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        credentials: isLocal ? 'include' : 'omit', // cookies only for local proxy
        body: JSON.stringify(
          isLocal
            ? { ipAddress, username, password, verifyTls }
            : { action: 'login', ipAddress, username, password, verifyTls }
        )
      });
      
      const result = await response.json();
      
      console.log('📥 Login response:', {
        ok: result.ok,
        status: result.status ?? response.status,
        message: result.message
      });
      
      // Check for successful login
      if (!result.ok || !response.ok) {
        const statusCode = result.status ?? response.status;
        const message = result.message ?? result.statusText ?? 'Unknown error';
        
        // Enhanced error messages with actionable information
        if (statusCode === 423) {
          throw new Error('CSM Session gesperrt (Code 29)\n\nDie CSM-Session ist gesperrt, da bereits eine aktive Verbindung besteht.\n\nLösung: Warten Sie 60 Sekunden und versuchen Sie es erneut.');
        }
        if (statusCode === 401) {
          throw new Error(`Authentifizierung fehlgeschlagen\n\nBenutzername oder Passwort ist falsch.\n\nBitte überprüfen Sie Ihre Zugangsdaten.`);
        }
        if (statusCode === 400) {
          throw new Error(`Login fehlgeschlagen: ${message}\n\nPrüfen Sie:\n- Benutzername und Passwort\n- Sind alle Felder ausgefüllt?`);
        }
        if (statusCode === 404) {
          throw new Error(`CSM NBI Endpoint nicht gefunden (HTTP 404)\n\nDer NBI Service ist auf ${ipAddress} nicht verfügbar.\n\nPrüfen Sie:\n- Ist die IP-Adresse korrekt?\n- Ist der NBI Service aktiviert? (Administration → License → NBI)\n- Läuft CSM auf diesem Server?`);
        }
        if (statusCode === 503) {
          throw new Error(`CSM NBI Service nicht verfügbar (HTTP 503)\n\nDer Service ist auf ${ipAddress} nicht erreichbar.\n\nPrüfen Sie:\n- Läuft der CSM Server?\n- Ist der NBI Service gestartet?\n- Prüfen Sie die CSM-Logs: $CSM_HOME/log/nbi.log`);
        }
        if (statusCode === 500 || statusCode >= 500) {
          throw new Error(`CSM Server-Fehler (HTTP ${statusCode})\n\n${message}\n\nDer CSM Server meldet einen internen Fehler. Prüfen Sie die Server-Logs.`);
        }
        
        // Generic error with status code
        throw new Error(`CSM Login fehlgeschlagen (HTTP ${statusCode})\n\n${message}`);
      }
      
      // Session als Platzhalter - Cookie wird vom Browser automatisch verwaltet
      this.session = { cookie: '', baseUrl: `http://${ipAddress}:1741/nbi/v1` };
      console.log('✅ Login erfolgreich, Session-Cookie gesetzt');
      return true;
      
    } catch (error) {
      // Enhanced error handling for network errors
      if (error instanceof TypeError && error.message.includes('fetch')) {
        throw new Error(`Netzwerkfehler beim Verbinden zu ${ipAddress}\n\nMögliche Ursachen:\n- Server nicht erreichbar\n- Firewall blockiert die Verbindung\n- Falsche IP-Adresse\n- CORS-Richtlinien blockieren die Anfrage\n\nLösung:\n- Prüfen Sie die Netzwerkverbindung\n- Stellen Sie sicher, dass der lokale Proxy läuft`);
      }
      
      // Re-throw any other errors
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

    return this.request('/v1/configservice/getPolicyObjectsListByType', requestXml);
  }

  private async request(endpoint: string, body: string) {
    if (!this.session) throw new Error('Nicht mit CSM verbunden');
    
    const ipAddress = this.session.baseUrl
      .replace('https://', '')
      .replace('http://', '')
      .replace(':1741', '')
      .replace('/nbi/v1', '')
      .replace('/nbi', '');
    
    const isLocal = this.isLocal;
    const url = isLocal ? this.proxyUrl : this.functionUrl;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (!isLocal) {
      headers['apikey'] = this.supabaseKey;
      headers['Authorization'] = `Bearer ${this.supabaseKey}`;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      credentials: isLocal ? 'include' : 'omit', // cookies only for local proxy
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

    return this.request('/v1/configservice/getPolicyObject', requestXml);
  }

  async getPolicyConfigByName(policyName: string, policyType: string = 'DeviceAccessRuleFirewallPolicy') {
    const requestXml = `<?xml version="1.0" encoding="UTF-8"?>
      <getPolicyConfigByNameRequest>
        <policyName>${policyName}</policyName>
        <policyType>${policyType}</policyType>
      </getPolicyConfigByNameRequest>`;

    return this.request('/v1/configservice/getPolicyConfigByName', requestXml);
  }

  async getPolicyConfigByDeviceGID(deviceGID: string, policyType: string = 'DeviceAccessRuleFirewallPolicy') {
    const requestXml = `<?xml version="1.0" encoding="UTF-8"?>
      <getPolicyConfigByDeviceGIDRequest>
        <deviceGID>${deviceGID}</deviceGID>
        <policyType>${policyType}</policyType>
      </getPolicyConfigByDeviceGIDRequest>`;

    return this.request('/v1/configservice/getPolicyConfigByDeviceGID', requestXml);
  }

  async execDeviceReadOnlyCLICmds({ deviceIP, command, argument }: CSMCLIQuery) {
    const requestXml = `<?xml version="1.0" encoding="UTF-8"?>
      <execDeviceReadOnlyCLICmdsRequest>
        <deviceIP>${deviceIP}</deviceIP>
        <cmd>${command}</cmd>
        ${argument ? `<argument>${argument}</argument>` : ''}
      </execDeviceReadOnlyCLICmdsRequest>`;

    return this.request('/v1/utilservice/execDeviceReadOnlyCLICmds', requestXml);
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
      const isLocal = this.isLocal;
      const url = isLocal ? this.proxyUrl : this.functionUrl;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (!isLocal) {
        headers['apikey'] = this.supabaseKey;
        headers['Authorization'] = `Bearer ${this.supabaseKey}`;
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        credentials: isLocal ? 'include' : 'omit', // cookies only for local proxy
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