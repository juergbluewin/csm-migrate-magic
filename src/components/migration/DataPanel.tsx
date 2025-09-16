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
import { Database, Download, Search, Edit, Server, Globe, Shield, Users, Network as NetworkIcon, List, FileText } from "lucide-react";
import { NetworkObject, ServiceObject, AccessList, AccessRule, LogEntry, ExportSelection, ExportSchema } from "../CiscoMigrationTool";

interface DataPanelProps {
  networkObjects: NetworkObject[];
  serviceObjects: ServiceObject[];
  accessLists: AccessList[];
  onNetworkObjectsChange: (objects: NetworkObject[]) => void;
  onServiceObjectsChange: (objects: ServiceObject[]) => void;
  onAccessListsChange: (lists: AccessList[]) => void;
  exportSelection: ExportSelection;
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
  addLog
}: DataPanelProps) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedObject, setSelectedObject] = useState<NetworkObject | null>(null);
  const [selectedService, setSelectedService] = useState<ServiceObject | null>(null);
  const [selectedAccessList, setSelectedAccessList] = useState<AccessList | null>(null);
  const [isObjectDialogOpen, setIsObjectDialogOpen] = useState(false);
  const [isServiceDialogOpen, setIsServiceDialogOpen] = useState(false);
  const [isAccessListDialogOpen, setIsAccessListDialogOpen] = useState(false);

  const loadDataFromCSM = async () => {
    addLog('info', 'Datenexport gestartet', 'Lade Objekte vom Security Manager...');
    
    // Simulate loading based on selection
    setTimeout(() => {
      if (exportSelection.networkObjects) {
        const mockNetworkObjects: NetworkObject[] = [
          { id: '1', name: 'srv-web01', type: 'host', value: '10.1.2.10', description: 'Web Server', firewall: 'ASA-DMZ' },
          { id: '2', name: 'net-dmz', type: 'network', value: '172.16.10.0/24', description: 'DMZ Network', firewall: 'ASA-DMZ' }
        ];
        onNetworkObjectsChange(mockNetworkObjects);
        addLog('success', 'Network Objects geladen', `${mockNetworkObjects.length} Objekte importiert`);
      }

      if (exportSelection.serviceObjects) {
        const mockServiceObjects: ServiceObject[] = [
          { id: '1', name: 'tcp-443', protocol: 'tcp', ports: '443', description: 'HTTPS Service' },
          { id: '2', name: 'web-services', protocol: 'tcp', ports: '80,443', description: 'HTTP and HTTPS' }
        ];
        onServiceObjectsChange(mockServiceObjects);
        addLog('success', 'Service Objects geladen', `${mockServiceObjects.length} Services importiert`);
      }

      if (exportSelection.accessLists) {
        const mockAccessLists: AccessList[] = [
          {
            id: '1',
            name: `${exportSelection.policyName || 'default'}-access-list`,
            firewall: 'ASA-DMZ',
            description: 'Access list for policy',
            rules: [{
              id: '1',
              policy: exportSelection.policyName || 'default',
              position: 1,
              name: 'allow-web',
              source: ['net-dmz'],
              destination: ['srv-web01'],
              services: ['web-services'],
              action: 'permit',
              from_zone: 'DMZ',
              to_zone: 'Inside',
              disabled: false,
              logging: 'default'
            }]
          }
        ];
        onAccessListsChange(mockAccessLists);
        addLog('success', 'Access Lists geladen', `${mockAccessLists.length} Listen importiert`);
      }
    }, 1000);
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