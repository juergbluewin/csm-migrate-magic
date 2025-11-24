import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { NetworkObject, ServiceObject, AccessList, AccessRule, LogEntry, ExportSelection, ExportSchema } from "../CiscoMigrationTool";
import { CSMConnection } from "../CiscoMigrationTool";
import { ExportConfigDialog } from "./ExportConfigDialog";
import { ExportResultsPanel } from "./ExportResultsPanel";
import { CSMExportService, ExportResult, ExportConfig } from "@/lib/csmExportService";

import { Database, Search, Server, List, Shield, FileText, Settings, Zap, CheckCircle, XCircle, FileWarning } from "lucide-react";
interface DataPanelProps {
  networkObjects: NetworkObject[];
  serviceObjects: ServiceObject[];
  accessLists: AccessList[];
  onNetworkObjectsChange: (objects: NetworkObject[]) => void;
  onServiceObjectsChange: (objects: ServiceObject[]) => void;
  onAccessListsChange: (lists: AccessList[]) => void;
  exportSelection: ExportSelection;
  csmConnection: CSMConnection;
  addLog: (level: LogEntry['level'], message: string, details?: string) => void;
}

export const DataPanel = ({
  networkObjects,
  serviceObjects,
  accessLists,
  onNetworkObjectsChange,
  onServiceObjectsChange,
  onAccessListsChange,
  exportSelection,
  csmConnection,
  addLog
}: DataPanelProps) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedObject, setSelectedObject] = useState<NetworkObject | null>(null);
  const [selectedService, setSelectedService] = useState<ServiceObject | null>(null);
  const [selectedAccessList, setSelectedAccessList] = useState<AccessList | null>(null);
  const [isObjectDialogOpen, setIsObjectDialogOpen] = useState(false);
  const [isServiceDialogOpen, setIsServiceDialogOpen] = useState(false);
  const [isAccessListDialogOpen, setIsAccessListDialogOpen] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportResult, setExportResult] = useState<ExportResult | null>(null);
  const [isExportConfigOpen, setIsExportConfigOpen] = useState(false);
  const [csmClient, setCsmClient] = useState<any>(null);
  const [selectedRule, setSelectedRule] = useState<AccessRule | null>(null);
  
  // Filter states for Access Lists
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'disabled'>('all');
  const [actionFilter, setActionFilter] = useState<'all' | 'permit' | 'deny'>('all');
  const [firewallFilter, setFirewallFilter] = useState<string>('all');

  const handleAdvancedExport = async (config: ExportConfig) => {
    setIsExporting(true);
    addLog('info', 'Erweiterten Export starten', `Format: ${config.format}, Batch-Größe: ${config.batchSize}`);
    
    try {
      const exportService = new CSMExportService();
      const result = await exportService.export(config);
      setExportResult(result);
      
      if (result.success) {
        addLog('success', 'Erweiterter Export abgeschlossen', 
          `${result.networkObjectsCount + result.serviceObjectsCount + result.accessRulesCount} Objekte exportiert`);
      } else {
        addLog('error', 'Export fehlgeschlagen', result.errors.map(e => e.message).join(', '));
      }
    } catch (error: any) {
      addLog('error', 'Export-Fehler', error.message);
    } finally {
      setIsExporting(false);
    }
  };

  const loadDataFromCSM = async () => {
    if (!csmConnection.ipAddress || !csmConnection.username || !csmConnection.password) {
      addLog('error', 'CSM Anmeldung erforderlich', 'Bitte zuerst CSM-Zugangsdaten eingeben und Verbindung testen');
      return;
    }

    // Check if anything is selected for export
    if (!exportSelection.networkObjects && !exportSelection.serviceObjects && !exportSelection.accessLists) {
      addLog('warning', 'Keine Objekte ausgewählt', 'Bitte gehen Sie zum "Auswahl" Tab und wählen Sie aus, welche Objekte exportiert werden sollen (Network Objects, Service Objects, Access Lists)');
      return;
    }

    console.log('🔄 Starte Datenexport von CSM:', csmConnection.ipAddress);
    console.log('📋 Export Auswahl:', exportSelection);
    addLog('info', 'Datenexport gestartet', `Lade Objekte vom CSM ${csmConnection.ipAddress} ...`);
    setIsLoading(true);
    
    try {
      const { CSMClient, CSMXMLParser } = await import('@/lib/csmClient');
      
      // Reuse existing client or create new one
      let client = csmClient;
      let loginSuccess = false;
      
      if (!client) {
        console.log('🆕 Erstelle neue CSM Client Instanz');
        client = new CSMClient();
        setCsmClient(client);
      } else {
        console.log('♻️ Verwende existierende CSM Client Instanz');
      }
      
      // Always try login - proxy will reuse session if valid
      console.log('📡 CSM Login/Session-Check...');
      addLog('info', 'CSM Login', 'Anmeldung am CSM...');
      loginSuccess = await client.login({
        ipAddress: csmConnection.ipAddress,
        username: csmConnection.username,
        password: csmConnection.password,
        verifyTls: csmConnection.verifyTls
      });

      console.log('✅ Login Ergebnis:', loginSuccess);
      if (!loginSuccess) {
        addLog('error', '❌ CSM Login fehlgeschlagen (HTTP 401)', 
          `Authentifizierung abgelehnt für Benutzer: ${csmConnection.username}\n\n` +
          `🔍 Lösungsvorschläge:\n\n` +
          `1️⃣ ZUGANGSDATEN PRÜFEN\n` +
          `   • Benutzername und Passwort korrekt?\n` +
          `   • Domain-Format benötigt? Versuchen Sie: "DOMAIN\\${csmConnection.username}"\n` +
          `   • Bei "@" im Benutzernamen: "user@domain.com" Format testen\n\n` +
          `2️⃣ CSM API LIZENZ (KRITISCH)\n` +
          `   • CSM: Tools → Security Manager Administration → Licensing\n` +
          `   • API Lizenz MUSS aktiviert sein (Professional Edition)\n` +
          `   • Error Code 26: "API license is not enabled" → Lizenz fehlt\n\n` +
          `3️⃣ API SERVICE\n` +
          `   • Administration Settings → "Enable API Service" aktiviert?\n` +
          `   • Max. aktive Sessions erreicht? (Standard: 5, Max: 10)\n` +
          `   • NBI Service Status: $CSM_HOME/bin/pdtool nbi status\n\n` +
          `4️⃣ BENUTZER-BERECHTIGUNGEN\n` +
          `   • Hat der Benutzer API-Zugriff in CSM?\n` +
          `   • Workflow/Ticketing Mode konfiguriert?\n\n` +
          `📖 Details: Cisco CSM API Spec v2.4, Seite 36-40 (Login Method)\n` +
          `🔗 Login Endpoint: https://${csmConnection.ipAddress}/nbi/login`);
        setIsLoading(false);
        return;
      }

      let allNetworkObjects: any[] = [];
      let allServiceObjects: any[] = [];
      let allAccessRules: any[] = [];

      // Load Network Objects
      if (exportSelection.networkObjects) {
        console.log('📦 Lade Network Objects...');
        addLog('info', 'Network Objects', 'Lade Network Objects...');
        
        const xmlData = await client.getPolicyObjectsList({
          policyObjectType: 'NetworkPolicyObject'
        });
        
        console.log(`  → Erhalte XML (Länge: ${xmlData?.length || 0})`);
        allNetworkObjects = CSMXMLParser.parseNetworkObjects(xmlData);
        console.log(`  → Geparst: ${allNetworkObjects.length} Objekte`);
        
        console.log(`✅ Network Objects fertig: ${allNetworkObjects.length} Objekte`);
        addLog('success', 'Network Objects', `${allNetworkObjects.length} Network Objects geladen`);
      }

      // Load Service Objects
      if (exportSelection.serviceObjects) {
        console.log('📦 Lade Service Objects...');
        addLog('info', 'Service Objects', 'Lade Service Objects...');
        
        const xmlData = await client.getPolicyObjectsList({
          policyObjectType: 'ServicePolicyObject'
        });
        
        console.log(`  → Erhalte XML (Länge: ${xmlData?.length || 0})`);
        allServiceObjects = CSMXMLParser.parseServiceObjects(xmlData);
        console.log(`  → Geparst: ${allServiceObjects.length} Objekte`);
        
        console.log(`✅ Service Objects fertig: ${allServiceObjects.length} Objekte`);
        addLog('success', 'Service Objects', `${allServiceObjects.length} Service Objects geladen`);
      }

      // Load Access Lists/Rules
      if (exportSelection.accessLists) {
        addLog('info', 'Access Lists', 'Lade Access Rules...');
        
        if (exportSelection.aclSource === 'policy') {
          // Load from policy
          const policyName = exportSelection.policyName || exportSelection.deviceGid;
          if (policyName) {
            let xmlData: string;
            if (exportSelection.policyName) {
              xmlData = await client.getPolicyConfigByName(exportSelection.policyName);
            } else if (exportSelection.deviceGid) {
              xmlData = await client.getPolicyConfigByDeviceGID(exportSelection.deviceGid);
            } else {
              throw new Error('Policy name or device GID required');
            }
            
            allAccessRules = CSMXMLParser.parseAccessRules(xmlData);
          }
        } else if (exportSelection.aclSource === 'cli' && exportSelection.deviceIp && exportSelection.cliCommand) {
          // Load from CLI
          const xmlData = await client.execDeviceReadOnlyCLICmds({
            deviceIP: exportSelection.deviceIp,
            command: 'show',
            argument: exportSelection.cliCommand.replace('show ', '')
          });
          
          allAccessRules = CSMXMLParser.parseAccessRules(xmlData);
        }
        
        addLog('success', 'Access Lists', `${allAccessRules.length} Access Rules geladen`);
      }

      // Convert to internal format
      const nObjs: NetworkObject[] = allNetworkObjects.map((n: any, idx) => ({
        id: `${n.name || 'net'}-${idx}`,
        name: n.name,
        type: (n.kind === 'host' ? 'host' : n.kind === 'subnet' ? 'network' : n.kind === 'range' ? 'range' : 'group') as NetworkObject['type'],
        value: n.value,
        ipAddress: n.ipAddress,
        netmask: n.netmask,
        startIp: n.startIp,
        endIp: n.endIp,
        description: n.description,
      }));
      onNetworkObjectsChange(nObjs);

      const sObjs: ServiceObject[] = allServiceObjects.map((s: any, idx) => ({
        id: `${s.name || 'svc'}-${idx}`,
        name: s.name,
        protocol: s.protocol || 'any',
        ports: s.ports || '',
        sourcePort: s.sourcePort,
        destPort: s.destPort,
        description: s.description,
      }));
      onServiceObjectsChange(sObjs);

      if (allAccessRules.length > 0) {
        // Determine device name from export selection
        let deviceName = 'unknown-device';
        if (exportSelection.deviceIp) {
          deviceName = exportSelection.deviceIp;
        } else if (exportSelection.deviceGid) {
          deviceName = exportSelection.deviceGid.split('-').pop() || exportSelection.deviceGid;
        } else if (exportSelection.policyName) {
          deviceName = exportSelection.policyName;
        }
        
        const list: AccessList = {
          id: 'acl-1',
          name: `ACL - ${deviceName}`,
          firewall: deviceName,
          rules: allAccessRules.map((rule: any, idx: number) => ({
            id: `${deviceName}-${rule.name || `rule-${idx}`}`,
            policy: rule.policy || 'unknown',
            position: rule.position || idx + 1,
            name: `${deviceName} | ${rule.name || `rule-${idx}`}`,
            source: rule.source || [],
            destination: rule.destination || [],
            services: rule.services || [],
            action: rule.action === 'allow' ? 'permit' : rule.action,
            from_zone: rule.from_zone,
            to_zone: rule.to_zone,
            disabled: rule.disabled || false,
            logging: rule.logging || 'default',
            description: rule.description
          }))
        };
        onAccessListsChange([list]);
      } else {
        onAccessListsChange([]);
      }

      // Keep session alive - don't logout after each export
      console.log(`✅ Datenexport erfolgreich: ${nObjs.length} Network Objects, ${sObjs.length} Service Objects, ${allAccessRules.length} ACL Rules`);
      addLog('success', 'Datenexport abgeschlossen', 
        `${nObjs.length} Network Objects, ${sObjs.length} Service Objects${allAccessRules.length ? `, ${allAccessRules.length} ACL Rules` : ''} importiert`);
    } catch (e: any) {
      console.error('❌ Datenexport Fehler:', e);
      const errorMessage = e?.message || 'Unbekannter Fehler';
      const errorStack = e?.stack || '';
      
      // If session error, clear client so new login is attempted
      if (errorMessage.includes('Session') || errorMessage.includes('401') || errorMessage.includes('423')) {
        console.log('🔄 Session-Fehler erkannt, Client wird zurückgesetzt');
        setCsmClient(null);
      }
      
      addLog('error', 'Export fehlgeschlagen', `${errorMessage}\n\nDetails: ${errorStack.substring(0, 200)}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <Server className="h-8 w-8 text-primary" />
              <div>
                <p className="text-2xl font-bold">{networkObjects.length}</p>
                <p className="text-sm text-muted-foreground">Network Objects</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <List className="h-8 w-8 text-primary" />
              <div>
                <p className="text-2xl font-bold">{serviceObjects.length}</p>
                <p className="text-sm text-muted-foreground">Service Objects</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <Shield className="h-8 w-8 text-primary" />
              <div>
                <p className="text-2xl font-bold">{accessLists.length}</p>
                <p className="text-sm text-muted-foreground">Access Lists</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <FileText className="h-8 w-8 text-primary" />
              <div>
                <p className="text-2xl font-bold">{accessLists.reduce((sum, list) => sum + list.rules.length, 0)}</p>
                <p className="text-sm text-muted-foreground">Total Rules</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Suche..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full sm:w-80"
          />
        </div>
        <div className="flex gap-2">
          <Button onClick={loadDataFromCSM} className="flex items-center gap-2">
            <Database className="h-4 w-4" />
            Daten laden
          </Button>
          <Button 
            variant="outline" 
            onClick={() => setIsExportConfigOpen(true)}
            className="flex items-center gap-2"
          >
            <Settings className="h-4 w-4" />
            Erweiterten Export
          </Button>
        </div>
      </div>

      <Tabs defaultValue="network" className="space-y-4">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="network">Network Objects ({networkObjects.length})</TabsTrigger>
          <TabsTrigger value="services">Service Objects ({serviceObjects.length})</TabsTrigger>
          <TabsTrigger value="acl">Access Lists ({accessLists.length})</TabsTrigger>
          <TabsTrigger value="export">Export-Ergebnisse</TabsTrigger>
        </TabsList>

        <TabsContent value="network">
          <Card>
            <CardHeader>
              <CardTitle>Network Objects</CardTitle>
              <CardDescription>Netzwerk-Objekte aus dem Cisco Security Manager (Global)</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Typ</TableHead>
                    <TableHead>IP-Adresse</TableHead>
                    <TableHead>Subnetzmaske/Bereich</TableHead>
                    <TableHead>Beschreibung</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {networkObjects.map((obj) => (
                    <TableRow key={obj.id}>
                      <TableCell className="font-medium">{obj.name}</TableCell>
                      <TableCell><Badge>{obj.type}</Badge></TableCell>
                      <TableCell className="font-mono text-sm">
                        {obj.type === 'host' && obj.ipAddress}
                        {obj.type === 'network' && obj.ipAddress}
                        {obj.type === 'range' && obj.startIp}
                        {!obj.ipAddress && !obj.startIp && obj.value}
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {obj.type === 'network' && obj.netmask}
                        {obj.type === 'range' && obj.endIp && `bis ${obj.endIp}`}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{obj.description}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="services">
          <Card>
            <CardHeader>
              <CardTitle>Service Objects</CardTitle>
              <CardDescription>Service-Objekte aus dem Cisco Security Manager (Global)</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Protokoll</TableHead>
                    <TableHead>Source Port</TableHead>
                    <TableHead>Destination Port</TableHead>
                    <TableHead>Beschreibung</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {serviceObjects.map((svc) => (
                    <TableRow key={svc.id}>
                      <TableCell className="font-medium">{svc.name}</TableCell>
                      <TableCell><Badge>{svc.protocol.toUpperCase()}</Badge></TableCell>
                      <TableCell className="font-mono text-sm">{svc.sourcePort || 'any'}</TableCell>
                      <TableCell className="font-mono text-sm">{svc.destPort || svc.ports}</TableCell>
                      <TableCell className="text-muted-foreground">{svc.description}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="acl">
          <Card>
            <CardHeader>
              <CardTitle>Access Lists - Regeln</CardTitle>
              <CardDescription>Access Control List Regeln aus dem Cisco Security Manager</CardDescription>
            </CardHeader>
            <CardContent>
              {/* Filter Controls */}
              <div className="mb-6 p-4 bg-muted/30 rounded-lg">
                <h4 className="text-sm font-semibold mb-3">Filter</h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="status-filter" className="text-xs">Status</Label>
                    <Select value={statusFilter} onValueChange={(value: any) => setStatusFilter(value)}>
                      <SelectTrigger id="status-filter" className="bg-background">
                        <SelectValue placeholder="Status wählen" />
                      </SelectTrigger>
                      <SelectContent className="bg-background z-50">
                        <SelectItem value="all">Alle</SelectItem>
                        <SelectItem value="active">Aktiviert</SelectItem>
                        <SelectItem value="disabled">Deaktiviert</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="action-filter" className="text-xs">Aktion</Label>
                    <Select value={actionFilter} onValueChange={(value: any) => setActionFilter(value)}>
                      <SelectTrigger id="action-filter" className="bg-background">
                        <SelectValue placeholder="Aktion wählen" />
                      </SelectTrigger>
                      <SelectContent className="bg-background z-50">
                        <SelectItem value="all">Alle</SelectItem>
                        <SelectItem value="permit">Permit</SelectItem>
                        <SelectItem value="deny">Deny</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="firewall-filter" className="text-xs">Firewall</Label>
                    <Select value={firewallFilter} onValueChange={setFirewallFilter}>
                      <SelectTrigger id="firewall-filter" className="bg-background">
                        <SelectValue placeholder="Firewall wählen" />
                      </SelectTrigger>
                      <SelectContent className="bg-background z-50">
                        <SelectItem value="all">Alle</SelectItem>
                        {Array.from(new Set(accessLists.map(list => list.firewall))).map(fw => (
                          <SelectItem key={fw} value={fw}>{fw}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                
                {/* Active Filter Summary */}
                {(statusFilter !== 'all' || actionFilter !== 'all' || firewallFilter !== 'all') && (
                  <div className="mt-3 flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Aktive Filter:</span>
                    {statusFilter !== 'all' && (
                      <Badge variant="outline" className="text-xs">
                        Status: {statusFilter === 'active' ? 'Aktiviert' : 'Deaktiviert'}
                      </Badge>
                    )}
                    {actionFilter !== 'all' && (
                      <Badge variant="outline" className="text-xs">
                        Aktion: {actionFilter}
                      </Badge>
                    )}
                    {firewallFilter !== 'all' && (
                      <Badge variant="outline" className="text-xs">
                        Firewall: {firewallFilter}
                      </Badge>
                    )}
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="h-6 text-xs"
                      onClick={() => {
                        setStatusFilter('all');
                        setActionFilter('all');
                        setFirewallFilter('all');
                      }}
                    >
                      Zurücksetzen
                    </Button>
                  </div>
                )}
              </div>
              
              <ScrollArea className="h-[600px]">
                {accessLists.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    Keine Access Lists geladen
                  </div>
                ) : (
                  accessLists
                    .filter(list => firewallFilter === 'all' || list.firewall === firewallFilter)
                    .map((list) => {
                      // Filter rules based on selected filters
                      const filteredRules = list.rules.filter(rule => {
                        const statusMatch = statusFilter === 'all' || 
                          (statusFilter === 'active' && !rule.disabled) ||
                          (statusFilter === 'disabled' && rule.disabled);
                        
                        const actionMatch = actionFilter === 'all' || rule.action === actionFilter;
                        
                        return statusMatch && actionMatch;
                      });
                      
                      // Don't show list if no rules match filters
                      if (filteredRules.length === 0) return null;
                      
                      return (
                        <div key={list.id} className="mb-6">
                          <div className="mb-3 p-3 bg-muted/30 rounded-lg">
                            <div className="flex items-center justify-between">
                              <div>
                                <h3 className="font-semibold text-lg">{list.name}</h3>
                                <p className="text-sm text-muted-foreground">Firewall: {list.firewall}</p>
                              </div>
                              <Badge variant="secondary">
                                {filteredRules.length} {filteredRules.length !== list.rules.length ? `von ${list.rules.length}` : ''} Regeln
                              </Badge>
                            </div>
                          </div>
                      
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-16">Pos.</TableHead>
                            <TableHead>Regelname</TableHead>
                            <TableHead>Quelle</TableHead>
                            <TableHead>Ziel</TableHead>
                            <TableHead>Service</TableHead>
                            <TableHead className="w-24">Aktion</TableHead>
                            <TableHead className="w-24">Status</TableHead>
                            <TableHead>Logging</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredRules.map((rule) => (
                            <TableRow 
                              key={rule.id}
                              className="cursor-pointer hover:bg-muted/50 transition-colors"
                              onClick={() => setSelectedRule(rule)}
                            >
                              <TableCell className="font-mono text-sm">{rule.position}</TableCell>
                              <TableCell className="font-medium">{rule.name}</TableCell>
                              <TableCell className="text-sm">
                                {rule.source.length > 0 ? (
                                  <div className="space-y-1">
                                    {rule.source.slice(0, 2).map((src, idx) => (
                                      <Badge key={idx} variant="outline" className="mr-1 mb-1 text-xs">
                                        {src}
                                      </Badge>
                                    ))}
                                    {rule.source.length > 2 && (
                                      <Badge variant="secondary" className="text-xs">
                                        +{rule.source.length - 2} mehr
                                      </Badge>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-muted-foreground">any</span>
                                )}
                              </TableCell>
                              <TableCell className="text-sm">
                                {rule.destination.length > 0 ? (
                                  <div className="space-y-1">
                                    {rule.destination.slice(0, 2).map((dst, idx) => (
                                      <Badge key={idx} variant="outline" className="mr-1 mb-1 text-xs">
                                        {dst}
                                      </Badge>
                                    ))}
                                    {rule.destination.length > 2 && (
                                      <Badge variant="secondary" className="text-xs">
                                        +{rule.destination.length - 2} mehr
                                      </Badge>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-muted-foreground">any</span>
                                )}
                              </TableCell>
                              <TableCell className="text-sm">
                                {rule.services.length > 0 ? (
                                  <div className="space-y-1">
                                    {rule.services.slice(0, 2).map((svc, idx) => (
                                      <Badge key={idx} variant="outline" className="mr-1 mb-1 text-xs">
                                        {svc}
                                      </Badge>
                                    ))}
                                    {rule.services.length > 2 && (
                                      <Badge variant="secondary" className="text-xs">
                                        +{rule.services.length - 2} mehr
                                      </Badge>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-muted-foreground">any</span>
                                )}
                              </TableCell>
                              <TableCell>
                                <Badge 
                                  variant={rule.action === 'permit' ? 'default' : 'destructive'}
                                  className="font-semibold"
                                >
                                  {rule.action}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-1">
                                  {rule.disabled ? (
                                    <>
                                      <XCircle className="h-4 w-4 text-muted-foreground" />
                                      <span className="text-xs text-muted-foreground">Deaktiviert</span>
                                    </>
                                  ) : (
                                    <>
                                      <CheckCircle className="h-4 w-4 text-green-600" />
                                      <span className="text-xs text-green-600">Aktiv</span>
                                    </>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell>
                                {rule.logging && rule.logging !== 'default' ? (
                                  <div className="flex items-center gap-1">
                                    <FileWarning className="h-4 w-4 text-amber-600" />
                                    <span className="text-xs">{rule.logging}</span>
                                  </div>
                                ) : (
                                  <span className="text-xs text-muted-foreground">Standard</span>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  );
                })
              )}
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="export">
          <ExportResultsPanel 
            result={exportResult}
            isLoading={isExporting}
          />
        </TabsContent>
      </Tabs>

      <ExportConfigDialog
        open={isExportConfigOpen}
        onOpenChange={setIsExportConfigOpen}
        exportSelection={exportSelection}
        csmConnection={csmConnection}
        onExport={handleAdvancedExport}
      />

      <Dialog open={!!selectedRule} onOpenChange={() => setSelectedRule(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Regel-Details: {selectedRule?.name}</DialogTitle>
            <DialogDescription>
              Vollständige Informationen für Regel an Position {selectedRule?.position}
            </DialogDescription>
          </DialogHeader>
          
          {selectedRule && (
            <div className="space-y-6">
              {/* Status und Aktion */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <h4 className="text-sm font-semibold mb-2">Status</h4>
                  <div className="flex items-center gap-2">
                    {selectedRule.disabled ? (
                      <>
                        <XCircle className="h-5 w-5 text-muted-foreground" />
                        <span>Deaktiviert</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle className="h-5 w-5 text-green-600" />
                        <span>Aktiviert</span>
                      </>
                    )}
                  </div>
                </div>
                <div>
                  <h4 className="text-sm font-semibold mb-2">Aktion</h4>
                  <Badge variant={selectedRule.action === 'permit' ? 'default' : 'destructive'} className="font-semibold">
                    {selectedRule.action}
                  </Badge>
                </div>
              </div>

              {/* Quellen */}
              <div>
                <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                  <Server className="h-4 w-4" />
                  Quellen ({selectedRule.source.length})
                </h4>
                <div className="flex flex-wrap gap-2">
                  {selectedRule.source.length > 0 ? (
                    selectedRule.source.map((src: string, i: number) => (
                      <Badge key={i} variant="outline">
                        {src}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-sm text-muted-foreground">Keine Quellen (any)</span>
                  )}
                </div>
              </div>

              {/* Ziele */}
              <div>
                <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                  <Database className="h-4 w-4" />
                  Ziele ({selectedRule.destination.length})
                </h4>
                <div className="flex flex-wrap gap-2">
                  {selectedRule.destination.length > 0 ? (
                    selectedRule.destination.map((dst: string, i: number) => (
                      <Badge key={i} variant="outline">
                        {dst}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-sm text-muted-foreground">Keine Ziele (any)</span>
                  )}
                </div>
              </div>

              {/* Services */}
              <div>
                <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                  <Settings className="h-4 w-4" />
                  Services ({selectedRule.services.length})
                </h4>
                <div className="flex flex-wrap gap-2">
                  {selectedRule.services.length > 0 ? (
                    selectedRule.services.map((svc: string, i: number) => (
                      <Badge key={i} variant="outline">
                        {svc}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-sm text-muted-foreground">Keine Services (any)</span>
                  )}
                </div>
              </div>

              {/* Logging */}
              <div>
                <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                  <FileWarning className="h-4 w-4" />
                  Logging
                </h4>
                {selectedRule.logging && selectedRule.logging !== 'default' ? (
                  <Badge variant="secondary">{selectedRule.logging}</Badge>
                ) : (
                  <span className="text-sm text-muted-foreground">Standard (kein spezielles Logging)</span>
                )}
              </div>

              {/* Beschreibung */}
              {selectedRule.description && (
                <div>
                  <h4 className="text-sm font-semibold mb-2">Beschreibung</h4>
                  <p className="text-sm text-muted-foreground">{selectedRule.description}</p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};