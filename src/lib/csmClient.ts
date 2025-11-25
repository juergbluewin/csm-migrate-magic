interface CSMSession {
  cookie: string;
  baseUrl: string;
  sessionId?: string;
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

const generateReqId = () => Math.random().toString(16).slice(2, 10);

export class CSMClient {
  private session: CSMSession | null = null;

  async login({ ipAddress, username, password, verifyTls }: CSMLoginRequest): Promise<boolean> {
    console.log('🔐 CSM Login via proxy', { 
      ipAddress, 
      verifyTls, 
      timestamp: new Date().toISOString() 
    });
    
    try {
      const { resolveCsmProxyBase } = await import('./proxyResolver');
      const url = resolveCsmProxyBase();

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'login',
          ipAddress,
          username,
          password,
          verifyTls
        })
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
      
      // Store session with sessionId from proxy
      const sessionId = result.sessionId;
      if (!sessionId) {
        throw new Error('No sessionId returned from proxy');
      }
      
      this.session = { 
        cookie: '', 
        baseUrl: `http://${ipAddress}:1741/nbi/v1`,
        sessionId 
      };
      console.log('✅ Login erfolgreich, sessionId:', sessionId);
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

  async getPolicyObjectsList({ policyObjectType, limit, offset }: CSMObjectQuery) {
    if (!this.session) throw new Error('Nicht mit CSM verbunden');

    // CSM API supports pagination with limit=1000 per request
    // We'll fetch in batches until no more objects are returned
    const batchSize = 1000;
    let currentOffset = 0;
    let allXmlResponses: string[] = [];
    let totalObjectsLoaded = 0;

    console.log(`📦 Fetching ${policyObjectType} objects from CSM with pagination (batch size: ${batchSize})...`);

    while (true) {
      const requestXml = `<?xml version="1.0" encoding="UTF-8"?>
<csm:policyObjectsListByTypeRequest xmlns:csm="csm">
  <protVersion>1.0</protVersion>
  <reqId>${generateReqId()}</reqId>
  <policyObjectType>${policyObjectType}</policyObjectType>
  <limit>${batchSize}</limit>
  <offset>${currentOffset}</offset>
</csm:policyObjectsListByTypeRequest>`;

      console.log(`  → Batch ${Math.floor(currentOffset / batchSize) + 1}: offset=${currentOffset}, limit=${batchSize}`);
      const xmlData = await this.request('/configservice/getPolicyObjectsListByType', requestXml);
      
      // Parse to count objects in this batch
      const parser = new DOMParser();
      const doc = parser.parseFromString(xmlData, 'text/xml');
      const objectElements = doc.querySelectorAll(
        policyObjectType === 'NetworkPolicyObject' ? 'networkPolicyObject' : 'servicePolicyObject'
      );
      const objectCount = objectElements.length;
      
      console.log(`  → Received ${objectCount} objects in this batch`);
      totalObjectsLoaded += objectCount;
      
      if (objectCount > 0) {
        allXmlResponses.push(xmlData);
      }
      
      // Stop if we received fewer objects than the batch size (reached the end)
      if (objectCount < batchSize) {
        console.log(`✅ Pagination complete: ${totalObjectsLoaded} total ${policyObjectType} objects loaded`);
        break;
      }
      
      currentOffset += batchSize;
    }

    // Merge all XML responses into a single response
    if (allXmlResponses.length === 0) {
      console.log(`  → No objects found`);
      return '<?xml version="1.0" encoding="UTF-8"?><csm:response xmlns:csm="csm"></csm:response>';
    }

    if (allXmlResponses.length === 1) {
      return allXmlResponses[0];
    }

    // Merge multiple XML responses by extracting all object elements
    console.log(`  → Merging ${allXmlResponses.length} XML responses...`);
    const parser = new DOMParser();
    const mergedDoc = parser.parseFromString(allXmlResponses[0], 'text/xml');
    const rootElement = mergedDoc.documentElement;

    // Extract and append all object elements from subsequent responses
    for (let i = 1; i < allXmlResponses.length; i++) {
      const doc = parser.parseFromString(allXmlResponses[i], 'text/xml');
      const objectElements = doc.querySelectorAll(
        policyObjectType === 'NetworkPolicyObject' ? 'networkPolicyObject' : 'servicePolicyObject'
      );
      
      objectElements.forEach(element => {
        const importedNode = mergedDoc.importNode(element, true);
        rootElement.appendChild(importedNode);
      });
    }

    const serializer = new XMLSerializer();
    const mergedXml = serializer.serializeToString(mergedDoc);
    console.log(`  → Merged XML size: ${mergedXml.length} bytes`);
    
    return mergedXml;
  }

  async getDeviceList() {
    if (!this.session) throw new Error('Nicht mit CSM verbunden');

    // API Spec v2.4: getDeviceList Request Format
    const requestXml = `<?xml version="1.0" encoding="UTF-8"?>
<csm:deviceListRequest xmlns:csm="csm">
  <protVersion>1.0</protVersion>
  <reqId>${generateReqId()}</reqId>
</csm:deviceListRequest>`;

    console.log('📱 Fetching device list from CSM...');
    return this.request('/configservice/getDeviceList', requestXml);
  }

  private async request(endpoint: string, body: string) {
    if (!this.session) throw new Error('Nicht mit CSM verbunden');
    
    const ipAddress = this.session.baseUrl
      .replace('https://', '')
      .replace('http://', '')
      .replace(':1741', '')
      .replace('/nbi/v1', '')
      .replace('/nbi', '');
    
    const { resolveCsmProxyBase } = await import('./proxyResolver');
    const url = resolveCsmProxyBase();

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        action: 'request', 
        ipAddress, 
        endpoint, 
        body, 
        sessionId: (this.session as any).sessionId 
      })
    });
    
    const result = await response.json();
    
    // Prüfe explizit auf ok:true
    if (result.ok !== true || !response.ok) {
      const statusCode = result.status ?? response.status;
      const statusText = result.statusText ?? response.statusText ?? 'Unknown error';
      const responseBody = result.body || '';
      
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
      
      // Parse error details from CSM XML response
      let errorDetails = statusText;
      if (responseBody && typeof responseBody === 'string') {
        // Try to extract error message from XML
        const codeMatch = responseBody.match(/<code>(\d+)<\/code>/i);
        const messageMatch = responseBody.match(/<message>([^<]+)<\/message>/i);
        const errorCode = codeMatch?.[1] || 'unknown';
        const errorMessage = messageMatch?.[1] || statusText;
        
        if (codeMatch || messageMatch) {
          // Provide more helpful hints for common generic errors
          if (errorCode === '1' && /Unknown error/i.test(errorMessage)) {
            errorDetails = `Error Code 1: Unknown error.\n\nMögliche Ursachen auf dem CSM-Server:\n- API-Lizenz für die Config API fehlt oder ist abgelaufen (Tools → Security Manager Administration → Licensing → NBI/API).\n- Der NBI-Dienst ist nicht vollständig initialisiert oder in einem Fehlerzustand.\n- Die angeforderte Operation (z.B. getPolicyObjectsListByType) wird von dieser CSM-Version/Konfiguration nicht unterstützt.`;
          } else {
            errorDetails = `Error Code ${errorCode}: ${errorMessage}`;
          }
        }
        
        // Log full response for debugging
        console.error('📛 CSM Error Response:', {
          endpoint,
          status: statusCode,
          errorCode,
          errorMessage,
          fullBody: responseBody.substring(0, 500)
        });
      }
      
      throw new Error(`CSM Request fehlgeschlagen: HTTP ${statusCode}\n\n${errorDetails}\n\nEndpoint: ${endpoint}`);
    }
    
    return String(result.body || '');
  }

  async getPolicyObject(objectName: string, objectType: 'NetworkPolicyObject' | 'ServicePolicyObject') {
    // API Spec v2.4: getPolicyObject Request Format
    const wrapperTag = objectType === 'NetworkPolicyObject' ? 'networkPolicyObject' : 'servicePolicyObject';
    const requestXml = `<?xml version="1.0" encoding="UTF-8"?>
<csm:getPolicyObjectRequest xmlns:csm="csm">
  <protVersion>1.0</protVersion>
  <reqId>${generateReqId()}</reqId>
  <${wrapperTag}>
    <name>${objectName}</name>
  </${wrapperTag}>
</csm:getPolicyObjectRequest>`;

    return this.request('/configservice', requestXml);
  }

  async getPolicyConfigByName(policyName: string, policyType: string = 'DeviceAccessRuleFirewallPolicy') {
    // API Spec v2.4, Table 68: getPolicyConfigByName Request Format
    const requestXml = `<?xml version="1.0" encoding="UTF-8"?>
<csm:getPolicyConfigByNameRequest xmlns:csm="csm">
  <protVersion>1.0</protVersion>
  <reqId>${generateReqId()}</reqId>
  <policyName>${policyName}</policyName>
  <policyType>${policyType}</policyType>
</csm:getPolicyConfigByNameRequest>`;

    return this.request('/configservice', requestXml);
  }

  async getPolicyConfigByDeviceGID(deviceGID: string, policyType: string = 'DeviceAccessRuleFirewallPolicy') {
    // API Spec v2.4, Table 71: getPolicyConfigByDeviceGID Request Format  
    const requestXml = `<?xml version="1.0" encoding="UTF-8"?>
<csm:getPolicyConfigByDeviceGIDRequest xmlns:csm="csm">
  <protVersion>1.0</protVersion>
  <reqId>${generateReqId()}</reqId>
  <deviceGID>${deviceGID}</deviceGID>
  <policyType>${policyType}</policyType>
</csm:getPolicyConfigByDeviceGIDRequest>`;

    return this.request('/configservice', requestXml);
  }

  async execDeviceReadOnlyCLICmds({ deviceIP, command, argument }: CSMCLIQuery) {
    // API Spec v2.4, Table 115: execDeviceReadOnlyCLICmds Request Format
    const requestXml = `<?xml version="1.0" encoding="UTF-8"?>
<csm:execDeviceReadOnlyCLICmdsRequest xmlns:csm="csm">
  <protVersion>1.0</protVersion>
  <reqId>${generateReqId()}</reqId>
  <deviceIP>${deviceIP}</deviceIP>
  <cmd>${command}</cmd>
  ${argument ? `<argument>${argument}</argument>` : ''}
</csm:execDeviceReadOnlyCLICmdsRequest>`;

    return this.request('/utilservice', requestXml);
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
      const { resolveCsmProxyBase } = await import('./proxyResolver');
      const url = resolveCsmProxyBase();

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          action: 'logout', 
          ipAddress, 
          sessionId: (this.session as any).sessionId 
        })
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
    const objects: any[] = [];
    
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlData, 'text/xml');
    
    const networkObjects = doc.querySelectorAll('networkPolicyObject');
    networkObjects.forEach((obj, index) => {
      const name = obj.querySelector('name')?.textContent || `object-${index}`;
      const kind = obj.querySelector('kind')?.textContent || 'host';
      const value = obj.querySelector('value')?.textContent || '';
      const description = obj.querySelector('description')?.textContent || '';
      
      // Parse IP details from value
      let ipAddress = '';
      let netmask = '';
      let startIp = '';
      let endIp = '';
      
      if (kind === 'host') {
        ipAddress = value;
      } else if (kind === 'subnet') {
        // Format: "192.168.1.0/24" or "192.168.1.0 255.255.255.0"
        if (value.includes('/')) {
          const parts = value.split('/');
          ipAddress = parts[0];
          netmask = parts[1]; // CIDR notation
        } else if (value.includes(' ')) {
          const parts = value.split(' ');
          ipAddress = parts[0];
          netmask = parts[1]; // Subnet mask
        }
      } else if (kind === 'range') {
        // Format: "192.168.1.1-192.168.1.254"
        if (value.includes('-')) {
          const parts = value.split('-');
          startIp = parts[0];
          endIp = parts[1];
        }
      }
      
      objects.push({
        name,
        kind,
        value,
        ipAddress,
        netmask,
        startIp,
        endIp,
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
      
      // Parse port details
      let sourcePort = '';
      let destPort = '';
      
      // Format can be: "80", "1024-65535", "any", "eq 80", "range 1024 65535"
      if (ports.includes('-') && !ports.includes('range')) {
        destPort = ports; // Range like "1024-65535"
      } else if (ports.startsWith('eq ')) {
        destPort = ports.replace('eq ', ''); // Single port
      } else if (ports.startsWith('range ')) {
        destPort = ports.replace('range ', '').replace(' ', '-'); // Convert to "1024-65535"
      } else {
        destPort = ports;
      }
      
      objects.push({
        name,
        protocol,
        ports,
        sourcePort,
        destPort,
        description
      });
    });
    
    return objects;
  }

  static parseAccessRules(xmlData: string): any[] {
    const rules: any[] = [];
    
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlData, 'text/xml');
    
    // CSM liefert deviceAccessRuleFirewallPolicy oder deviceAccessRuleUnifiedFirewallPolicy
    const accessPolicies = doc.querySelectorAll('deviceAccessRuleFirewallPolicy, deviceAccessRuleUnifiedFirewallPolicy');
    
    accessPolicies.forEach((policy, index) => {
      const name =
        policy.querySelector('name')?.textContent ||
        policy.querySelector('gid')?.textContent ||
        `rule-${index}`;

      // CSM hat <permit>true/false</permit>
      const permitText = policy.querySelector('permit')?.textContent?.toLowerCase() || 'true';
      const action = permitText === 'true' ? 'permit' : 'deny';

      // Quellen: unter <sources> mit verschiedenen Unterelementen
      const sourcesNode = policy.querySelector('sources');
      const sources: string[] = [];
      if (sourcesNode) {
        sources.push(
          ...Array.from(sourcesNode.querySelectorAll('networkObjectGIDs > gid')).map(
            n => n.textContent || ''
          ),
          ...Array.from(sourcesNode.querySelectorAll('ipv4Data')).map(
            n => n.textContent || ''
          )
        );
      }

      // Ziele: analog unter <destinations>
      const destinationsNode = policy.querySelector('destinations');
      const destinations: string[] = [];
      if (destinationsNode) {
        destinations.push(
          ...Array.from(destinationsNode.querySelectorAll('networkObjectGIDs > gid')).map(
            n => n.textContent || ''
          ),
          ...Array.from(destinationsNode.querySelectorAll('ipv4Data')).map(
            n => n.textContent || ''
          )
        );
      }

      // Services: unter <services>, i. d. R. GIDs für ServicePolicyObject
      const servicesNode = policy.querySelector('services');
      const services: string[] = [];
      if (servicesNode) {
        services.push(
          ...Array.from(servicesNode.querySelectorAll('serviceObjectGIDs > gid')).map(
            n => n.textContent || ''
          )
        );
      }

      const disabled = policy.querySelector('isEnabled')?.textContent === 'false';

      const logging =
        policy.querySelector('logOptions > iosOptions')?.textContent ||
        policy.querySelector('logOptions > logOption')?.textContent ||
        '';

      rules.push({
        policy: 'imported',
        position: index + 1,
        name,
        source: sources,
        destination: destinations,
        services,
        action,
        disabled,
        logging
      });
    });
    
    return rules;
  }
}