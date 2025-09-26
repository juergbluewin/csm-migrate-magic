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
import { NetworkObject, ServiceObject, AccessList, AccessRule, LogEntry, ExportSelection, ExportSchema } from "../CiscoMigrationTool";
import { CSMConnection } from "../CiscoMigrationTool";
import { ExportConfigDialog } from "./ExportConfigDialog";
import { ExportResultsPanel } from "./ExportResultsPanel";
import { CSMExportService, ExportResult, ExportConfig } from "@/lib/csmExportService";

import { Database, Search, Server, List, Shield, FileText, Settings, Zap } from "lucide-react";
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
    if (!csmConnection.username || !csmConnection.password) {
      addLog('error', 'CSM Anmeldung erforderlich', 'Bitte zuerst CSM-Zugangsdaten eingeben und Verbindung testen');
      return;
    }

    addLog('info', 'Datenexport gestartet', `Lade Objekte vom CSM ${csmConnection.ipAddress} ...`);
    setIsLoading(true);
    
    try {
      const { CSMClient, CSMXMLParser } = await import('@/lib/csmClient');
      const client = new CSMClient();
      
      // Login to CSM
      addLog('info', 'CSM Login', 'Anmeldung am CSM...');
      const loginSuccess = await client.login({
        ipAddress: csmConnection.ipAddress,
        username: csmConnection.username,
        password: csmConnection.password,
        verifyTls: csmConnection.verifyTls
      });

      if (!loginSuccess) {
        addLog('error', 'CSM Login fehlgeschlagen', 'Überprüfen Sie Benutzername und Passwort');
        setIsLoading(false);
        return;
      }

      let allNetworkObjects: any[] = [];
      let allServiceObjects: any[] = [];
      let allAccessRules: any[] = [];

      // Load Network Objects
      if (exportSelection.networkObjects) {
        addLog('info', 'Network Objects', 'Lade Network Objects...');
        let offset = 0;
        let hasMore = true;
        
        while (hasMore) {
          const xmlData = await client.getPolicyObjectsList({
            policyObjectType: 'NetworkPolicyObject',
            limit: 100,
            offset
          });
          
          const objects = CSMXMLParser.parseNetworkObjects(xmlData);
          allNetworkObjects.push(...objects);
          
          // Simple pagination check - if we got less than limit, we're done
          hasMore = objects.length === 100;
          offset += 100;
        }
        
        addLog('success', 'Network Objects', `${allNetworkObjects.length} Network Objects geladen`);
      }

      // Load Service Objects
      if (exportSelection.serviceObjects) {
        addLog('info', 'Service Objects', 'Lade Service Objects...');
        let offset = 0;
        let hasMore = true;
        
        while (hasMore) {
          const xmlData = await client.getPolicyObjectsList({
            policyObjectType: 'ServicePolicyObject',
            limit: 100,
            offset
          });
          
          const objects = CSMXMLParser.parseServiceObjects(xmlData);
          allServiceObjects.push(...objects);
          
          hasMore = objects.length === 100;
          offset += 100;
        }
        
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
        description: n.description,
      }));
      onNetworkObjectsChange(nObjs);

      const sObjs: ServiceObject[] = allServiceObjects.map((s: any, idx) => ({
        id: `${s.name || 'svc'}-${idx}`,
        name: s.name,
        protocol: s.protocol || 'any',
        ports: s.ports || '',
        description: s.description,
      }));
      onServiceObjectsChange(sObjs);

      if (allAccessRules.length > 0) {
        const list: AccessList = {
          id: 'acl-1',
          name: 'Imported ACL',
          firewall: csmConnection.ipAddress,
          rules: allAccessRules.map((rule: any, idx: number) => ({
            id: `${rule.name || `rule-${idx}`}`,
            policy: rule.policy || 'unknown',
            position: rule.position || idx + 1,
            name: rule.name || `rule-${idx}`,
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

      // Logout from CSM
      client.logout();
      
      addLog('success', 'Datenexport abgeschlossen', 
        `${nObjs.length} Network Objects, ${sObjs.length} Service Objects${allAccessRules.length ? `, ${allAccessRules.length} ACL Rules` : ''} importiert`);
    } catch (e: any) {
      addLog('error', 'Export fehlgeschlagen', e?.message || 'Unbekannter Fehler');
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
              <CardDescription>Netzwerk-Objekte aus dem Cisco Security Manager</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Typ</TableHead>
                    <TableHead>Wert</TableHead>
                    <TableHead>Firewall</TableHead>
                    <TableHead>Beschreibung</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {networkObjects.map((obj) => (
                    <TableRow key={obj.id}>
                      <TableCell className="font-medium">{obj.name}</TableCell>
                      <TableCell><Badge>{obj.type}</Badge></TableCell>
                      <TableCell className="font-mono text-sm">{obj.value}</TableCell>
                      <TableCell>{obj.firewall && <Badge variant="outline">{obj.firewall}</Badge>}</TableCell>
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
              <CardDescription>Service-Objekte aus dem Cisco Security Manager</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Protokoll</TableHead>
                    <TableHead>Ports</TableHead>
                    <TableHead>Beschreibung</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {serviceObjects.map((svc) => (
                    <TableRow key={svc.id}>
                      <TableCell className="font-medium">{svc.name}</TableCell>
                      <TableCell><Badge>{svc.protocol.toUpperCase()}</Badge></TableCell>
                      <TableCell className="font-mono text-sm">{svc.ports}</TableCell>
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
              <CardTitle>Access Lists</CardTitle>
              <CardDescription>Access Control Lists aus dem Cisco Security Manager</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Firewall</TableHead>
                    <TableHead>Regeln</TableHead>
                    <TableHead>Beschreibung</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {accessLists.map((list) => (
                    <TableRow key={list.id}>
                      <TableCell className="font-medium">{list.name}</TableCell>
                      <TableCell><Badge variant="outline">{list.firewall}</Badge></TableCell>
                      <TableCell><Badge variant="secondary">{list.rules.length} Regeln</Badge></TableCell>
                      <TableCell className="text-muted-foreground">{list.description}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
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
    </div>
  );
};