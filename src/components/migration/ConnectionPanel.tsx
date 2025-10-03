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

  // Erweitertes Troubleshooting für CSM Verbindung
  const generateCorrelationId = () => Math.random().toString(36).slice(2, 10);

  const runCSMDiagnostics = async () => {
    const cid = generateCorrelationId();
    const ip = (csmConnection.ipAddress || '').trim();
    addLog('info', 'CSM Diagnose gestartet', `Korrelation-ID: ${cid}`);

    if (!ip) {
      addLog('error', 'Diagnose', 'CSM IP-Adresse fehlt');
      return;
    }

    // Validate IP address format
    const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$|^[a-zA-Z0-9.-]+$/;
    if (!ipRegex.test(ip)) {
      addLog('error', 'IP-Format ungültig', `"${ip}" ist keine gültige IP-Adresse oder Hostname`);
      return;
    }

    addLog('info', 'Netzwerk-Analyse', `Prüfe Erreichbarkeit von ${ip}...`);

    const httpsUrl = `https://${ip}/nbi/`;
    const httpUrl = `http://${ip}/nbi/`;
    const loginUrl = `https://${ip}/nbi/login`;
    const timeoutMs = 8000;
    const results: string[] = [];
    let totalTests = 0;
    let failedTests = 0;

    const analyzeError = (error: any): string => {
      if (error?.name === 'AbortError') return 'Timeout - Server antwortet nicht innerhalb von 8 Sekunden';
      if (error?.message?.includes('Failed to fetch')) return 'Netzwerkfehler - Server nicht erreichbar oder CORS-Problem';
      if (error?.message?.includes('net::ERR_NAME_NOT_RESOLVED')) return 'DNS-Fehler - Hostname kann nicht aufgelöst werden';
      if (error?.message?.includes('net::ERR_CONNECTION_REFUSED')) return 'Verbindung verweigert - Port geschlossen oder Service läuft nicht';
      if (error?.message?.includes('net::ERR_CONNECTION_TIMED_OUT')) return 'Verbindungs-Timeout - Firewall oder Routing-Problem';
      if (error?.message?.includes('net::ERR_CERT_')) return 'SSL-Zertifikat-Problem';
      return error?.message || 'Unbekannter Netzwerkfehler';
    };

    const testEndpoint = async (url: string, label: string, method: string = 'GET') => {
      totalTests++;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        
        const response = await fetch(url, { 
          method, 
          mode: 'no-cors', 
          signal: controller.signal,
          headers: method === 'POST' ? { 'Content-Type': 'application/xml' } : {}
        });
        
        clearTimeout(timer);
        addLog('success', `${label} Test`, `✓ Verbindung zu ${url} erfolgreich (Response durch CORS möglicherweise blockiert)`);
        results.push(`${label}: ✓ Erreichbar`);
        return true;
      } catch (error: any) {
        failedTests++;
        const detailedError = analyzeError(error);
        addLog('error', `${label} Test fehlgeschlagen`, `✗ ${url}\nFehler: ${detailedError}`);
        results.push(`${label}: ✗ ${detailedError}`);
        return false;
      }
    };

    // Test verschiedene Endpunkte
    const httpsOk = await testEndpoint(httpsUrl, 'HTTPS NBI');
    const httpsLoginOk = await testEndpoint(loginUrl, 'HTTPS Login', 'POST');
    
    if (!httpsOk && !httpsLoginOk) {
      addLog('info', 'Fallback Test', 'HTTPS fehlgeschlagen, teste HTTP...');
      await testEndpoint(httpUrl, 'HTTP NBI');
    }

    // Zusätzliche Diagnose-Informationen
    addLog('info', 'Browser-Umgebung', 
      `User-Agent: ${navigator.userAgent.substring(0, 100)}...\n` +
      `Protokoll: ${window.location.protocol}\n` +
      `Host: ${window.location.host}`);

    // Zusammenfassung
    const successRate = ((totalTests - failedTests) / totalTests * 100).toFixed(0);
    addLog('info', 'Diagnose Zusammenfassung', 
      `${totalTests} Tests durchgeführt, ${failedTests} fehlgeschlagen (${successRate}% erfolgreich)\n\n` +
      results.join('\n'));

    // Spezifische Troubleshooting-Schritte
    if (failedTests === totalTests) {
      addLog('warning', 'Alle Tests fehlgeschlagen - Mögliche Ursachen', 
        '1. CSM Server ist nicht gestartet oder reagiert nicht\n' +
        '2. IP-Adresse/Hostname ist falsch\n' +
        '3. Firewall blockiert Port 443/80\n' +
        '4. Netzwerk-Routing-Problem\n' +
        '5. CSM NBI Service ist deaktiviert');
        
      addLog('info', 'Empfohlene Schritte zur Fehlerbehebung',
        '1. Ping-Test: ping ' + ip + '\n' +
        '2. Port-Test: telnet ' + ip + ' 443\n' +
        '3. CSM Login über Browser: https://' + ip + '/login\n' +
        '4. CSM NBI aktivieren: Administration → License → NBI\n' +
        '5. Firewall-Regeln prüfen\n' +
        '6. CSM Logs prüfen: $CSM_HOME/log/');
    } else {
      addLog('info', 'Nächste Schritte',
        'Verbindung teilweise erfolgreich - CORS könnte die API-Antworten blockieren.\n' +
        'Versuchen Sie jetzt die CSM-Anmeldung mit Ihren Zugangsdaten.');
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