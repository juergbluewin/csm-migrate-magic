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
import { callCloudFunction } from "@/lib/cloudClient";
import { Database, Search, Server, List, Shield, FileText } from "lucide-react";
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

  const loadDataFromCSM = async () => {
    addLog('info', 'Datenexport gestartet', `Lade Objekte vom CSM ${csmConnection.ipAddress} ...`);
    setIsLoading(true);
    try {
      const res = await callCloudFunction<ExportSchema>('csm-nbi', {
        action: 'export',
        ipAddress: csmConnection.ipAddress,
        verifyTls: csmConnection.verifyTls,
        selection: exportSelection,
      });

      const nObjs: NetworkObject[] = (res.network_objects || []).map((n: any, idx) => ({
        id: `${n.name || 'net'}-${idx}`,
        name: n.name,
        type: (n.kind === 'host' ? 'host' : n.kind === 'subnet' ? 'network' : n.kind === 'range' ? 'range' : 'group') as NetworkObject['type'],
        value: n.value,
        description: n.description,
      }));
      onNetworkObjectsChange(nObjs);

      const sObjs: ServiceObject[] = (res.service_objects || []).map((s: any, idx) => ({
        id: `${s.name || 'svc'}-${idx}`,
        name: s.name,
        protocol: s.protocol || 'any',
        ports: s.ports || '',
        description: s.description,
      }));
      onServiceObjectsChange(sObjs);

      if (res.acl_rules && res.acl_rules.length > 0) {
        const list: AccessList = {
          id: 'acl-1',
          name: res.acl_rules[0].policy || 'AccessPolicy',
          firewall: '',
          rules: res.acl_rules.map((r, i) => ({ ...r, id: r.id || `rule-${i}` })),
        };
        onAccessListsChange([list]);
      } else {
        onAccessListsChange([]);
      }

      addLog('success', 'Export abgeschlossen', `Netz: ${nObjs.length}, Services: ${sObjs.length}, ACL-Regeln: ${res.acl_rules?.length || 0}`);
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
        <Button onClick={loadDataFromCSM} className="flex items-center gap-2">
          <Database className="h-4 w-4" />
          Daten laden
        </Button>
      </div>

      <Tabs defaultValue="network" className="space-y-4">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="network">Network Objects ({networkObjects.length})</TabsTrigger>
          <TabsTrigger value="services">Service Objects ({serviceObjects.length})</TabsTrigger>
          <TabsTrigger value="acl">Access Lists ({accessLists.length})</TabsTrigger>
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
      </Tabs>
    </div>
  );
};