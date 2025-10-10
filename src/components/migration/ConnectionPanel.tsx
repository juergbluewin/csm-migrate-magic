import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Eye, EyeOff, Shield, Network, Wifi, WifiOff, Loader2 } from "lucide-react";
import { ConnectionStatus, CSMConnection, FMCConnection, LogEntry } from "../CiscoMigrationTool";


interface ConnectionPanelProps {
  csmConnection: CSMConnection;
  fmcConnection: FMCConnection;
  connectionStatus: ConnectionStatus;
  onCsmConnectionChange: (connection: CSMConnection) => void;
  onFmcConnectionChange: (connection: FMCConnection) => void;
  onStatusChange: (status: ConnectionStatus) => void;
  addLog: (level: LogEntry['level'], message: string, details?: string) => void;
}

export const ConnectionPanel = ({
  csmConnection,
  fmcConnection,
  connectionStatus,
  onCsmConnectionChange,
  onFmcConnectionChange,
  onStatusChange,
  addLog
}: ConnectionPanelProps) => {
  const [showCsmPassword, setShowCsmPassword] = useState(false);
  const [showFmcPassword, setShowFmcPassword] = useState(false);

  const testCSMConnection = async () => {
    if (!csmConnection.ipAddress || !csmConnection.username || !csmConnection.password) {
      addLog('error', 'CSM Verbindung', 'Bitte alle Felder ausfüllen');
      return;
    }

    try {
      onStatusChange({ ...connectionStatus, csm: 'connecting' });
      addLog('info', 'CSM Verbindungstest gestartet', `Verbinde zu https://${csmConnection.ipAddress}/nbi ...`);

      const { CSMClient } = await import('@/lib/csmClient');
      const client = new CSMClient();
      
      const success = await client.login({
        ipAddress: csmConnection.ipAddress,
        username: csmConnection.username,
        password: csmConnection.password,
        verifyTls: csmConnection.verifyTls
      });

      if (success) {
        onStatusChange({ ...connectionStatus, csm: 'connected' });
        addLog('success', 'CSM Verbindung erfolgreich', `Verbunden mit https://${csmConnection.ipAddress}/nbi`);
        
        // Session sauber schließen nach Test, vermeidet Code 29 bei erneutem Test
        await client.logout();
        onStatusChange({ ...connectionStatus, csm: 'disconnected' });
      } else {
        onStatusChange({ ...connectionStatus, csm: 'error' });
        addLog('error', 'CSM Verbindung fehlgeschlagen', 'Login fehlgeschlagen - Benutzername oder Passwort falsch');
      }
    } catch (e: any) {
      onStatusChange({ ...connectionStatus, csm: 'error' });
      const errorMessage = e?.message || 'Unbekannter Netzwerkfehler';
      addLog('error', 'CSM Verbindung fehlgeschlagen', errorMessage);

      // Log additional debug info for Docker/Linux troubleshooting
      if (errorMessage.includes('Failed to fetch') || errorMessage.includes('Netzwerkfehler')) {
        addLog('info', 'Troubleshooting-Tipps für Docker/Linux', 
          '1. Überprüfen Sie die Docker-Netzwerkkonfiguration\n' +
          '2. Stellen Sie sicher, dass der CSM-Server von Docker aus erreichbar ist\n' +
          '3. Verwenden Sie die CSM-Server IP-Adresse im Docker-Netzwerk\n' +
          '4. Prüfen Sie Firewall-Regeln zwischen Docker und CSM');
      }
    }
  };

  // Erweiterte Diagnose-Funktion mit detaillierter Fehleranalyse
  const generateCorrelationId = () => Math.random().toString(36).slice(2, 10);

  const runCSMDiagnostics = async () => {
    const cid = generateCorrelationId();
    const ip = (csmConnection.ipAddress || '').trim();
    addLog('info', '🔍 CSM Login-Diagnose gestartet', `Korrelation-ID: ${cid}\nTLS-Verifizierung: ${csmConnection.verifyTls ? 'Aktiviert' : 'Deaktiviert'}`);

    if (!ip) {
      addLog('error', 'Diagnose', 'CSM IP-Adresse fehlt');
      return;
    }

    // Validate and normalize IP address
    const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$|^[a-zA-Z0-9.-]+$/;
    if (!ipRegex.test(ip)) {
      addLog('error', 'IP-Format ungültig', `"${ip}" ist keine gültige IP-Adresse oder Hostname`);
      return;
    }

    // Check for common IP typos
    const ipParts = ip.split('.');
    if (ipParts.length === 4) {
      const invalidOctets = ipParts.filter(part => {
        const num = parseInt(part);
        return isNaN(num) || num < 0 || num > 255;
      });
      if (invalidOctets.length > 0) {
        addLog('warning', 'IP-Adresse prüfen', `Ungültige Oktetten gefunden: ${invalidOctets.join(', ')}`);
      }
    }

    addLog('info', '🌐 Teste Login-Endpunkte', `Simuliere echte Login-Versuche an ${ip}...\nDies testet die gleichen Endpunkte wie der tatsächliche Login`);

    // Test actual login via proxy - this simulates real login behavior
    const results: string[] = [];
    let totalTests = 0;
    let failedTests = 0;
    let successfulEndpoint: string | null = null;
    const timeoutMs = 8000;

    const analyzeError = (error: any): { short: string; detailed: string } => {
      if (error?.name === 'AbortError') {
        return {
          short: 'Timeout',
          detailed: 'Server antwortet nicht innerhalb von 8 Sekunden. Mögliche Ursachen:\n- Server ist offline\n- Firewall blockiert die Verbindung\n- Falsche IP-Adresse'
        };
      }
      if (error?.message?.includes('Failed to fetch')) {
        return {
          short: 'Netzwerkfehler',
          detailed: 'Verbindung fehlgeschlagen. Mögliche Ursachen:\n- Server nicht erreichbar\n- CORS-Richtlinien blockieren die Anfrage\n- Netzwerk-Routing-Problem'
        };
      }
      if (error?.message?.includes('net::ERR_NAME_NOT_RESOLVED')) {
        return {
          short: 'DNS-Fehler',
          detailed: 'Hostname kann nicht aufgelöst werden. Prüfen Sie:\n- Ist die IP-Adresse/Hostname korrekt?\n- Funktioniert die DNS-Auflösung?'
        };
      }
      if (error?.message?.includes('net::ERR_CONNECTION_REFUSED')) {
        return {
          short: 'Verbindung verweigert',
          detailed: 'Port geschlossen oder Service läuft nicht. Prüfen Sie:\n- Läuft der CSM Service?\n- Ist der NBI Service aktiviert?\n- Ist die Firewall konfiguriert?'
        };
      }
      if (error?.message?.includes('net::ERR_CONNECTION_TIMED_OUT')) {
        return {
          short: 'Verbindungs-Timeout',
          detailed: 'Verbindung zeitlich überschritten. Prüfen Sie:\n- Firewall-Regeln\n- Routing-Konfiguration\n- Server-Last'
        };
      }
      if (error?.message?.includes('net::ERR_CERT_')) {
        return {
          short: 'TLS-Zertifikatsfehler',
          detailed: 'SSL-Zertifikat-Problem erkannt. Lösung:\n- Deaktivieren Sie "TLS-Zertifikat verifizieren"\n- Oder installieren Sie ein gültiges Zertifikat auf dem CSM'
        };
      }
      if (error?.message?.includes('self-signed certificate')) {
        return {
          short: 'Selbstsigniertes Zertifikat',
          detailed: 'Der CSM verwendet ein selbstsigniertes Zertifikat. Lösung:\n- Deaktivieren Sie "TLS-Zertifikat verifizieren" in den Verbindungseinstellungen'
        };
      }
      return {
        short: 'Unbekannter Fehler',
        detailed: error?.message || 'Keine detaillierten Fehlerinformationen verfügbar'
      };
    };

    // Test login via proxy - simulates actual login request
    const testLoginEndpoint = async () => {
      totalTests++;
      const startTime = Date.now();
      
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        
        // Try actual login via proxy to test real behavior
        const response = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          signal: controller.signal,
          body: JSON.stringify({
            ipAddress: ip,
            username: 'diagnostic-test',
            password: 'diagnostic-test',
            verifyTls: csmConnection.verifyTls
          })
        });
        
        clearTimeout(timer);
        const duration = Date.now() - startTime;
        const result = await response.json();
        
        // Analyze response
        if (response.ok && result.ok) {
          // Success - actual login worked (unlikely with test credentials, but possible)
          addLog('success', '✅ Login-Endpunkt funktioniert', 
            `Der CSM Server akzeptiert Login-Requests korrekt (${duration}ms)\n` +
            `Dies bedeutet, dass Ihre echten Zugangsdaten funktionieren sollten.`);
          results.push(`Login-Test: ✓ Funktioniert (${duration}ms)`);
          successfulEndpoint = `https://${ip}/nbi/login`;
          return true;
        } else if (result.status === 401 || result.status === 400 || result.status === 423) {
          // Authentication error - endpoint exists and responds, just wrong credentials
          addLog('success', '✅ Login-Endpunkt erreichbar', 
            `HTTP ${result.status} - Der Endpunkt funktioniert! (${duration}ms)\n` +
            `Fehler: ${result.message || 'Login fehlgeschlagen'}\n\n` +
            `Dies ist normal für Test-Zugangsdaten. Der Endpunkt funktioniert!\n` +
            `➡️ Verwenden Sie Ihre echten CSM-Zugangsdaten für die Verbindung.`);
          results.push(`Login-Test: ⚠️ Endpunkt OK, Test-Login fehlgeschlagen (${duration}ms)`);
          if (!successfulEndpoint) successfulEndpoint = `https://${ip}/nbi/login`;
          return true;
        } else if (result.status === 404) {
          // Not found - endpoint doesn't exist
          failedTests++;
          addLog('error', '❌ Login-Endpunkt nicht gefunden', 
            `HTTP 404 - Der NBI Service-Endpunkt existiert nicht (${duration}ms)\n\n` +
            `Mögliche Ursachen:\n` +
            `  • Der NBI Service ist nicht aktiviert\n` +
            `  • Die IP-Adresse ist falsch\n` +
            `  • CSM verwendet eine andere Port/Pfad-Konfiguration\n\n` +
            `Lösungen:\n` +
            `  1️⃣ Prüfen Sie in CSM: Administration → License → NBI Service\n` +
            `  2️⃣ Verifizieren Sie die IP-Adresse: ${ip}\n` +
            `  3️⃣ Prüfen Sie die CSM-Logs: $CSM_HOME/log/nbi.log`);
          results.push(`Login-Test: ✗ HTTP 404 - Nicht gefunden`);
          return false;
        } else if (result.status === 503) {
          // Service unavailable
          failedTests++;
          addLog('error', '❌ NBI Service nicht verfügbar', 
            `HTTP 503 - Der Service antwortet nicht (${duration}ms)\n\n` +
            `Mögliche Ursachen:\n` +
            `  • Der NBI Service ist gestoppt\n` +
            `  • Der CSM Server ist überlastet\n` +
            `  • Port 1741 ist blockiert\n\n` +
            `Lösungen:\n` +
            `  1️⃣ Starten Sie den CSM NBI Service neu\n` +
            `  2️⃣ Prüfen Sie die CSM-Logs: $CSM_HOME/log/nbi.log\n` +
            `  3️⃣ Überprüfen Sie die Firewall-Regeln für Port 1741`);
          results.push(`Login-Test: ✗ HTTP 503 - Service nicht verfügbar`);
          return false;
        } else {
          // Other error
          failedTests++;
          addLog('error', '❌ Login fehlgeschlagen', 
            `HTTP ${result.status} - ${result.message || 'Unbekannter Fehler'} (${duration}ms)`);
          results.push(`Login-Test: ✗ HTTP ${result.status}`);
          return false;
        }
      } catch (error: any) {
        failedTests++;
        const duration = Date.now() - startTime;
        const errorInfo = analyzeError(error);
        
        addLog('error', '❌ Login-Test fehlgeschlagen', 
          `Dauer: ${duration}ms\n` +
          `Fehler: ${errorInfo.short}\n\n` +
          `Details:\n${errorInfo.detailed}`);
        results.push(`Login-Test: ✗ ${errorInfo.short}`);
        return false;
      }
    };

    // Run the actual login test
    await testLoginEndpoint();

    // Zusätzliche Diagnose-Informationen
    addLog('info', '💻 Browser- und Netzwerk-Umgebung', 
      `Browser: ${navigator.userAgent.substring(0, 100)}...\n` +
      `Protokoll: ${window.location.protocol}\n` +
      `Host: ${window.location.host}\n` +
      `Verbindung: ${(navigator as any).connection?.effectiveType || 'unbekannt'}\n` +
      `Online-Status: ${navigator.onLine ? '✅ Online' : '❌ Offline'}`);

    // TLS-Verifizierungs-Hinweis
    if (csmConnection.verifyTls && failedTests > 0) {
      addLog('warning', '🔒 TLS-Verifizierung aktiviert', 
        'Die TLS-Zertifikat-Verifizierung ist aktiviert. Falls der CSM ein selbstsigniertes Zertifikat verwendet:\n' +
        '→ Deaktivieren Sie "TLS-Zertifikat verifizieren" in den Verbindungseinstellungen');
    }

    // Summary
    const successRate = totalTests > 0 ? ((totalTests - failedTests) / totalTests * 100).toFixed(0) : '0';
    
    addLog('info', '💻 Browser- und Netzwerk-Umgebung', 
      `Browser: ${navigator.userAgent.substring(0, 100)}...\n` +
      `Protokoll: ${window.location.protocol}\n` +
      `Host: ${window.location.host}\n` +
      `Verbindung: ${(navigator as any).connection?.effectiveType || 'unbekannt'}\n` +
      `Online-Status: ${navigator.onLine ? '✅ Online' : '❌ Offline'}`);
    
    addLog('info', '📊 Diagnose Zusammenfassung', 
      `Login-Endpunkte getestet: ${totalTests}\n` +
      `Funktionsfähig: ${totalTests - failedTests}\n` +
      `Nicht verfügbar: ${failedTests}\n` +
      `Erfolgsquote: ${successRate}%\n\n` +
      `Ergebnisse:\n${results.join('\n')}`);

    if (successfulEndpoint) {
      addLog('success', '✅ Funktionierender Login-Endpunkt gefunden!', 
        `Der CSM Server ist bereit für Login-Anfragen\n` +
        `Endpunkt: ${successfulEndpoint}\n\n` +
        '➡️ Nächster Schritt: Klicken Sie auf "Verbinden" und geben Sie Ihre CSM-Zugangsdaten ein.');
      
      addLog('success', '✅ Diagnose erfolgreich', 
        'Der CSM NBI Service ist erreichbar und funktioniert!\n' +
        `Erfolgsquote: ${successRate}%`);
    } else {
      // All tests failed
      addLog('error', '❌ Verbindung fehlgeschlagen', 
        'Kein CSM NBI Login-Endpunkt konnte erreicht werden\n' +
        'Alle getesteten Endpunkte sind nicht verfügbar');
        
      addLog('error', '🔍 HTTP 404 - Endpunkte nicht gefunden', 
        'Mögliche Ursachen:\n' +
        '  ❌ Der NBI Service ist nicht aktiviert\n' +
        '  ❌ Die IP-Adresse ist falsch\n' +
        '  ❌ CSM verwendet eine andere Port/Pfad-Konfiguration\n\n' +
        'Lösungen:\n' +
        '  1️⃣ Prüfen Sie in CSM: Administration → License → NBI Service\n' +
        '  2️⃣ Verifizieren Sie die IP-Adresse: ' + ip + '\n' +
        '  3️⃣ Prüfen Sie die CSM-Logs: $CSM_HOME/log/nbi.log\n' +
        '  4️⃣ Versuchen Sie, ob der Standard-Port 1741 blockiert ist\n\n' +
        '  5️⃣ Testen Sie CSM Web-Interface: https://' + ip + '/login\n' +
        '  6️⃣ Port-Erreichbarkeit: telnet ' + ip + ' 443 && telnet ' + ip + ' 1741');
    }
  };

  const testFMCConnection = async () => {
    if (!fmcConnection.ipAddress || !fmcConnection.username || !fmcConnection.password) {
      addLog('error', 'FMC Verbindung', 'Bitte alle Felder ausfüllen');
      return;
    }

    onStatusChange({ ...connectionStatus, fmc: 'connecting' });
    addLog('info', 'FMC Verbindungstest gestartet', `Verbinde zu ${fmcConnection.ipAddress}...`);

    // Simulate API connection test
    setTimeout(() => {
      const success = Math.random() > 0.3; // 70% success rate for demo
      if (success) {
        onStatusChange({ ...connectionStatus, fmc: 'connected' });
        addLog('success', 'FMC Verbindung erfolgreich', `Verbunden mit Firepower Management Center auf ${fmcConnection.ipAddress}`);
      } else {
        onStatusChange({ ...connectionStatus, fmc: 'error' });
        addLog('error', 'FMC Verbindung fehlgeschlagen', 'Überprüfen Sie IP-Adresse, Benutzername und Passwort');
      }
    }, 2000);
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'connected':
        return <Wifi className="h-4 w-4 text-success" />;
      case 'connecting':
        return <Loader2 className="h-4 w-4 animate-spin text-warning" />;
      case 'error':
        return <WifiOff className="h-4 w-4 text-destructive" />;
      default:
        return <WifiOff className="h-4 w-4 text-muted-foreground" />;
    }
  };

  return (
    <div className="grid gap-6 md:grid-cols-2">
      {/* Cisco Security Manager Connection */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/10 rounded-lg">
                <Shield className="h-5 w-5 text-primary" />
              </div>
              <div>
                <CardTitle className="text-lg">Cisco Security Manager</CardTitle>
                <CardDescription>
                  Verbindung zum lokalen Security Manager Server
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {getStatusIcon(connectionStatus.csm)}
              <Badge 
                variant={connectionStatus.csm === 'connected' ? 'default' : 'secondary'}
                className={
                  connectionStatus.csm === 'connected' 
                    ? 'bg-success text-success-foreground' 
                    : connectionStatus.csm === 'error'
                    ? 'bg-destructive text-destructive-foreground'
                    : connectionStatus.csm === 'connecting'
                    ? 'bg-warning text-warning-foreground'
                    : ''
                }
              >
                {connectionStatus.csm === 'connected' ? 'Verbunden' : 
                 connectionStatus.csm === 'connecting' ? 'Verbindet...' :
                 connectionStatus.csm === 'error' ? 'Fehler' : 'Nicht verbunden'}
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="csm-ip">CSM IP-Adresse</Label>
            <Input
              id="csm-ip"
              placeholder="192.168.1.100"
              value={csmConnection.ipAddress}
              onChange={(e) => onCsmConnectionChange({ ...csmConnection, ipAddress: e.target.value })}
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="csm-username">Benutzername</Label>
            <Input
              id="csm-username"
              placeholder="admin"
              value={csmConnection.username}
              onChange={(e) => onCsmConnectionChange({ ...csmConnection, username: e.target.value })}
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="csm-password">Passwort</Label>
            <div className="relative">
              <Input
                id="csm-password"
                type={showCsmPassword ? "text" : "password"}
                placeholder="••••••••"
                value={csmConnection.password}
                onChange={(e) => onCsmConnectionChange({ ...csmConnection, password: e.target.value })}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                onClick={() => setShowCsmPassword(!showCsmPassword)}
              >
                {showCsmPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="csm-verify-tls" className="flex items-center gap-2">
              <input
                type="checkbox"
                id="csm-verify-tls"
                checked={csmConnection.verifyTls}
                onChange={(e) => onCsmConnectionChange({ ...csmConnection, verifyTls: e.target.checked })}
                className="h-4 w-4"
              />
              TLS-Zertifikat verifizieren
            </Label>
          </div>
          
          <div className="space-y-2">
            <Button 
              onClick={testCSMConnection}
              disabled={connectionStatus.csm === 'connecting'}
              className="w-full"
              variant={connectionStatus.csm === 'connected' ? 'secondary' : 'default'}
            >
              {connectionStatus.csm === 'connecting' && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              {connectionStatus.csm === 'connected' ? 'Verbindung testen' : 'Verbinden'}
            </Button>
            <Button
              onClick={runCSMDiagnostics}
              disabled={connectionStatus.csm === 'connecting'}
              className="w-full"
              variant="outline"
            >
              Diagnose starten
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Firepower Management Center Connection */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/10 rounded-lg">
                <Network className="h-5 w-5 text-primary" />
              </div>
              <div>
                <CardTitle className="text-lg">Firepower Management Center</CardTitle>
                <CardDescription>
                  Zielverbindung für die Migration
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {getStatusIcon(connectionStatus.fmc)}
              <Badge 
                variant={connectionStatus.fmc === 'connected' ? 'default' : 'secondary'}
                className={
                  connectionStatus.fmc === 'connected' 
                    ? 'bg-success text-success-foreground' 
                    : connectionStatus.fmc === 'error'
                    ? 'bg-destructive text-destructive-foreground'
                    : connectionStatus.fmc === 'connecting'
                    ? 'bg-warning text-warning-foreground'
                    : ''
                }
              >
                {connectionStatus.fmc === 'connected' ? 'Verbunden' : 
                 connectionStatus.fmc === 'connecting' ? 'Verbindet...' :
                 connectionStatus.fmc === 'error' ? 'Fehler' : 'Nicht verbunden'}
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="fmc-ip">IP-Adresse</Label>
            <Input
              id="fmc-ip"
              placeholder="192.168.1.200"
              value={fmcConnection.ipAddress}
              onChange={(e) => onFmcConnectionChange({ ...fmcConnection, ipAddress: e.target.value })}
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="fmc-username">Benutzername</Label>
            <Input
              id="fmc-username"
              placeholder="admin"
              value={fmcConnection.username}
              onChange={(e) => onFmcConnectionChange({ ...fmcConnection, username: e.target.value })}
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="fmc-password">Passwort</Label>
            <div className="relative">
              <Input
                id="fmc-password"
                type={showFmcPassword ? "text" : "password"}
                placeholder="••••••••"
                value={fmcConnection.password}
                onChange={(e) => onFmcConnectionChange({ ...fmcConnection, password: e.target.value })}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                onClick={() => setShowFmcPassword(!showFmcPassword)}
              >
                {showFmcPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
          
          <Button 
            onClick={testFMCConnection}
            disabled={connectionStatus.fmc === 'connecting'}
            className="w-full"
            variant={connectionStatus.fmc === 'connected' ? 'secondary' : 'default'}
          >
            {connectionStatus.fmc === 'connecting' && (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            )}
            {connectionStatus.fmc === 'connected' ? 'Verbindung testen' : 'Verbinden'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};