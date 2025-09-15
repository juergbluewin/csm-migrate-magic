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
import { 
  Database, 
  Download, 
  Search, 
  Edit, 
  Trash2, 
  Plus, 
  Server, 
  Globe,
  Shield,
  Users,
  Network as NetworkIcon,
  List
} from "lucide-react";
import { NetworkObject, AccessList, AccessRule, LogEntry } from "../CiscoMigrationTool";

interface DataPanelProps {
  networkObjects: NetworkObject[];
  accessLists: AccessList[];
  onNetworkObjectsChange: (objects: NetworkObject[]) => void;
  onAccessListsChange: (lists: AccessList[]) => void;
  addLog: (level: LogEntry['level'], message: string, details?: string) => void;
}

export const DataPanel = ({
  networkObjects,
  accessLists,
  onNetworkObjectsChange,
  onAccessListsChange,
  addLog
}: DataPanelProps) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedObject, setSelectedObject] = useState<NetworkObject | null>(null);
  const [selectedAccessList, setSelectedAccessList] = useState<AccessList | null>(null);
  const [isObjectDialogOpen, setIsObjectDialogOpen] = useState(false);
  const [isAccessListDialogOpen, setIsAccessListDialogOpen] = useState(false);

  const loadDataFromCSM = async () => {
    addLog('info', 'Daten werden vom CSM geladen...', 'Starte API-Abfrage für Netzwerkobjekte und Access-Listen');
    
    // Simulate API call to load data
    setTimeout(() => {
      const mockNetworkObjects: NetworkObject[] = [
        {
          id: '1',
          name: 'DMZ_Servers',
          type: 'network',
          value: '192.168.100.0/24',
          description: 'DMZ Server Network',
          firewall: 'ASA-01'
        },
        {
          id: '2',
          name: 'Web_Server',
          type: 'host',
          value: '192.168.100.10',
          description: 'Main Web Server',
          firewall: 'ASA-01'
        },
        {
          id: '3',
          name: 'DB_Servers',
          type: 'group',
          value: 'Web_Server,App_Server',
          description: 'Database Server Group',
          firewall: 'ASA-02'
        }
      ];

      const mockAccessLists: AccessList[] = [
        {
          id: '1',
          name: 'ASA-01_OUTSIDE_IN',
          firewall: 'ASA-01',
          description: 'Outside to Inside Access List',
          rules: [
            {
              id: '1',
              action: 'permit',
              protocol: 'tcp',
              source: 'any',
              destination: 'DMZ_Servers',
              port: '80,443',
              description: 'Allow HTTP/HTTPS to DMZ'
            },
            {
              id: '2',
              action: 'deny',
              protocol: 'ip',
              source: 'any',
              destination: 'any',
              description: 'Deny all other traffic'
            }
          ]
        },
        {
          id: '2',
          name: 'ASA-02_DMZ_IN',
          firewall: 'ASA-02',
          description: 'DMZ to Inside Access List',
          rules: [
            {
              id: '3',
              action: 'permit',
              protocol: 'tcp',
              source: 'DMZ_Servers',
              destination: 'DB_Servers',
              port: '3306',
              description: 'Allow MySQL access'
            }
          ]
        }
      ];

      onNetworkObjectsChange(mockNetworkObjects);
      onAccessListsChange(mockAccessLists);
      addLog('success', 'Daten erfolgreich geladen', `${mockNetworkObjects.length} Netzwerkobjekte und ${mockAccessLists.length} Access-Listen geladen`);
    }, 2000);
  };

  const filteredNetworkObjects = networkObjects.filter(obj =>
    obj.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    obj.value.toLowerCase().includes(searchTerm.toLowerCase()) ||
    obj.firewall?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredAccessLists = accessLists.filter(list =>
    list.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    list.firewall.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getObjectTypeIcon = (type: NetworkObject['type']) => {
    switch (type) {
      case 'host':
        return <Server className="h-4 w-4" />;
      case 'network':
        return <NetworkIcon className="h-4 w-4" />;
      case 'range':
        return <Globe className="h-4 w-4" />;
      case 'group':
        return <Users className="h-4 w-4" />;
      default:
        return <Database className="h-4 w-4" />;
    }
  };

  const getObjectTypeBadge = (type: NetworkObject['type']) => {
    const colors = {
      host: 'bg-blue-100 text-blue-800 border-blue-200',
      network: 'bg-green-100 text-green-800 border-green-200',
      range: 'bg-orange-100 text-orange-800 border-orange-200',
      group: 'bg-purple-100 text-purple-800 border-purple-200'
    };

    return (
      <Badge variant="outline" className={colors[type]}>
        {type.toUpperCase()}
      </Badge>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header with Stats and Actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/10 rounded-lg">
                <Database className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{networkObjects.length}</p>
                <p className="text-sm text-muted-foreground">Netzwerkobjekte</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-success/10 rounded-lg">
                <List className="h-5 w-5 text-success" />
              </div>
              <div>
                <p className="text-2xl font-bold">{accessLists.length}</p>
                <p className="text-sm text-muted-foreground">Access-Listen</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-warning/10 rounded-lg">
                <Shield className="h-5 w-5 text-warning" />
              </div>
              <div>
                <p className="text-2xl font-bold">
                  {accessLists.reduce((sum, list) => sum + list.rules.length, 0)}
                </p>
                <p className="text-sm text-muted-foreground">Regeln gesamt</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Actions */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Datenmanagement</CardTitle>
              <CardDescription>
                Laden und verwalten Sie Netzwerkobjekte und Access-Listen
              </CardDescription>
            </div>
            <Button onClick={loadDataFromCSM} className="flex items-center gap-2">
              <Download className="h-4 w-4" />
              Daten vom CSM laden
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Objekte und Listen durchsuchen..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Data Tabs */}
      <Tabs defaultValue="objects" className="space-y-4">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="objects" className="flex items-center gap-2">
            <Database className="h-4 w-4" />
            Netzwerkobjekte ({filteredNetworkObjects.length})
          </TabsTrigger>
          <TabsTrigger value="access-lists" className="flex items-center gap-2">
            <List className="h-4 w-4" />
            Access-Listen ({filteredAccessLists.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="objects">
          <Card>
            <CardHeader>
              <CardTitle>Netzwerkobjekte</CardTitle>
              <CardDescription>
                Verwaltung der Netzwerkobjekte aus dem Security Manager
              </CardDescription>
            </CardHeader>
            <CardContent>
              {filteredNetworkObjects.length === 0 ? (
                <div className="text-center py-8">
                  <Database className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <p className="text-muted-foreground">
                    {networkObjects.length === 0 
                      ? "Keine Netzwerkobjekte geladen. Klicken Sie auf 'Daten vom CSM laden'." 
                      : "Keine Objekte gefunden, die der Suche entsprechen."}
                  </p>
                </div>
              ) : (
                <ScrollArea className="h-[400px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Typ</TableHead>
                        <TableHead>Wert</TableHead>
                        <TableHead>Firewall</TableHead>
                        <TableHead>Beschreibung</TableHead>
                        <TableHead>Aktionen</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredNetworkObjects.map((obj) => (
                        <TableRow key={obj.id}>
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-2">
                              {getObjectTypeIcon(obj.type)}
                              {obj.name}
                            </div>
                          </TableCell>
                          <TableCell>
                            {getObjectTypeBadge(obj.type)}
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            {obj.value}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{obj.firewall}</Badge>
                          </TableCell>
                          <TableCell className="max-w-[200px] truncate">
                            {obj.description || '-'}
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-2">
                              <Button 
                                variant="ghost" 
                                size="sm"
                                onClick={() => {
                                  setSelectedObject(obj);
                                  setIsObjectDialogOpen(true);
                                }}
                              >
                                <Edit className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="access-lists">
          <Card>
            <CardHeader>
              <CardTitle>Access-Listen</CardTitle>
              <CardDescription>
                Verwaltung der Access-Listen aus dem Security Manager
              </CardDescription>
            </CardHeader>
            <CardContent>
              {filteredAccessLists.length === 0 ? (
                <div className="text-center py-8">
                  <List className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <p className="text-muted-foreground">
                    {accessLists.length === 0 
                      ? "Keine Access-Listen geladen. Klicken Sie auf 'Daten vom CSM laden'." 
                      : "Keine Listen gefunden, die der Suche entsprechen."}
                  </p>
                </div>
              ) : (
                <ScrollArea className="h-[400px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Firewall</TableHead>
                        <TableHead>Regeln</TableHead>
                        <TableHead>Beschreibung</TableHead>
                        <TableHead>Aktionen</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredAccessLists.map((list) => (
                        <TableRow key={list.id}>
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-2">
                              <List className="h-4 w-4" />
                              {list.name}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{list.firewall}</Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary">
                              {list.rules.length} Regeln
                            </Badge>
                          </TableCell>
                          <TableCell className="max-w-[200px] truncate">
                            {list.description || '-'}
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-2">
                              <Button 
                                variant="ghost" 
                                size="sm"
                                onClick={() => {
                                  setSelectedAccessList(list);
                                  setIsAccessListDialogOpen(true);
                                }}
                              >
                                <Edit className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Object Edit Dialog */}
      <Dialog open={isObjectDialogOpen} onOpenChange={setIsObjectDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Netzwerkobjekt bearbeiten</DialogTitle>
            <DialogDescription>
              Bearbeiten Sie die Eigenschaften des Netzwerkobjekts
            </DialogDescription>
          </DialogHeader>
          {selectedObject && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input value={selectedObject.name} readOnly />
              </div>
              <div className="space-y-2">
                <Label>Typ</Label>
                <Select value={selectedObject.type} disabled>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="host">Host</SelectItem>
                    <SelectItem value="network">Network</SelectItem>
                    <SelectItem value="range">Range</SelectItem>
                    <SelectItem value="group">Group</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Wert</Label>
                <Input value={selectedObject.value} readOnly />
              </div>
              <div className="space-y-2">
                <Label>Beschreibung</Label>
                <Textarea 
                  value={selectedObject.description || ''} 
                  placeholder="Objektbeschreibung..."
                  readOnly
                />
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Access List Edit Dialog */}
      <Dialog open={isAccessListDialogOpen} onOpenChange={setIsAccessListDialogOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Access-Liste bearbeiten</DialogTitle>
            <DialogDescription>
              Bearbeiten Sie die Access-Liste und ihre Regeln
            </DialogDescription>
          </DialogHeader>
          {selectedAccessList && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Name</Label>
                  <Input value={selectedAccessList.name} readOnly />
                </div>
                <div className="space-y-2">
                  <Label>Firewall</Label>
                  <Input value={selectedAccessList.firewall} readOnly />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Beschreibung</Label>
                <Textarea 
                  value={selectedAccessList.description || ''} 
                  placeholder="Access-Liste Beschreibung..."
                  readOnly
                />
              </div>
              <div className="space-y-2">
                <Label>Regeln ({selectedAccessList.rules.length})</Label>
                <ScrollArea className="h-[300px] border rounded-md">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Aktion</TableHead>
                        <TableHead>Protokoll</TableHead>
                        <TableHead>Quelle</TableHead>
                        <TableHead>Ziel</TableHead>
                        <TableHead>Port</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {selectedAccessList.rules.map((rule) => (
                        <TableRow key={rule.id}>
                          <TableCell>
                            <Badge 
                              variant={rule.action === 'permit' ? 'default' : 'destructive'}
                              className={rule.action === 'permit' ? 'bg-success text-success-foreground' : ''}
                            >
                              {rule.action.toUpperCase()}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-mono text-sm">{rule.protocol}</TableCell>
                          <TableCell className="font-mono text-sm">{rule.source}</TableCell>
                          <TableCell className="font-mono text-sm">{rule.destination}</TableCell>
                          <TableCell className="font-mono text-sm">{rule.port || '-'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};