import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ConnectionPanel } from "./migration/ConnectionPanel";
import { SelectionPanel } from "./migration/SelectionPanel";
import { LogPanel } from "./migration/LogPanel";
import { DataPanel } from "./migration/DataPanel";
import { MigrationPanel } from "./migration/MigrationPanel";
import { Header } from "./migration/Header";
import { Cpu, Network, Shield, Settings, FileText, ArrowRightLeft } from "lucide-react";

export interface ConnectionStatus {
  csm: 'disconnected' | 'connecting' | 'connected' | 'error';
  fmc: 'disconnected' | 'connecting' | 'connected' | 'error';
}

export interface CSMConnection {
  ipAddress: string;
  username: string;
  password: string;
  verifyTls: boolean;
}

export interface FMCConnection {
  ipAddress: string;
  username: string;
  password: string;
}

export interface LogEntry {
  id: string;
  timestamp: Date;
  level: 'info' | 'warning' | 'error' | 'success';
  message: string;
  details?: string;
}

export interface NetworkObject {
  id: string;
  name: string;
  type: 'host' | 'network' | 'range' | 'group';
  value: string;
  description?: string;
  firewall?: string;
}

export interface AccessList {
  id: string;
  name: string;
  firewall: string;
  rules: AccessRule[];
  description?: string;
}

export interface ServiceObject {
  id: string;
  name: string;
  protocol: 'tcp' | 'udp' | 'icmp' | 'any';
  ports: string;
  description?: string;
}

export interface AccessRule {
  id: string;
  policy: string;
  position: number;
  name: string;
  source: string[];
  destination: string[];
  services: string[];
  action: 'permit' | 'deny';
  from_zone?: string;
  to_zone?: string;
  disabled: boolean;
  logging: string;
  description?: string;
}

export interface ExportSelection {
  networkObjects: boolean;
  serviceObjects: boolean;
  accessLists: boolean;
  aclSource: 'policy' | 'cli';
  policyName?: string;
  deviceGid?: string;
  deviceIp?: string;
  cliCommand?: string;
}

export interface ExportSchema {
  network_objects: NetworkObject[];
  service_objects: ServiceObject[];
  acl_rules: AccessRule[];
  meta: {
    source: string;
    server: string;
    generated_at: string;
  };
}

const CiscoMigrationTool = () => {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>({
    csm: 'disconnected',
    fmc: 'disconnected'
  });

  const [csmConnection, setCsmConnection] = useState<CSMConnection>({
    ipAddress: '',
    username: '',
    password: '',
    verifyTls: true
  });

  const [fmcConnection, setFmcConnection] = useState<FMCConnection>({
    ipAddress: '',
    username: '',
    password: ''
  });

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [networkObjects, setNetworkObjects] = useState<NetworkObject[]>([]);
  const [serviceObjects, setServiceObjects] = useState<ServiceObject[]>([]);
  const [accessLists, setAccessLists] = useState<AccessList[]>([]);
  const [exportSelection, setExportSelection] = useState<ExportSelection>({
    networkObjects: true,
    serviceObjects: true,
    accessLists: true,
    aclSource: 'policy',
    policyName: '',
    deviceGid: '',
    deviceIp: '',
    cliCommand: 'show access-list'
  });

  const addLog = (level: LogEntry['level'], message: string, details?: string) => {
    const newLog: LogEntry = {
      id: Date.now().toString(),
      timestamp: new Date(),
      level,
      message,
      details
    };
    setLogs(prev => [newLog, ...prev]);
  };

  const resetTool = () => {
    setConnectionStatus({ csm: 'disconnected', fmc: 'disconnected' });
    setCsmConnection({ ipAddress: '', username: '', password: '', verifyTls: true });
    setFmcConnection({ ipAddress: '', username: '', password: '' });
    setLogs([]);
    setNetworkObjects([]);
    setServiceObjects([]);
    setAccessLists([]);
    setExportSelection({
      networkObjects: true,
      serviceObjects: true,
      accessLists: true,
      aclSource: 'policy',
      policyName: '',
      deviceGid: '',
      deviceIp: '',
      cliCommand: 'show access-list'
    });
    addLog('info', 'Tool wurde zurückgesetzt', 'Alle Daten und Verbindungen wurden gelöscht.');
  };

  return (
    <div className="min-h-screen bg-background">
      <Header 
        connectionStatus={connectionStatus}
        onReset={resetTool}
      />
      
      <main className="container mx-auto px-4 py-6">
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-primary/10 rounded-lg">
              <ArrowRightLeft className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">
                Cisco Security Migration Tool
              </h1>
              <p className="text-muted-foreground">
                Migration von Objekten und Access-Listen vom Security Manager zum Firepower Management Center
              </p>
            </div>
          </div>
          
          <div className="flex gap-4 mt-4">
            <Card className="flex-1">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <Shield className="h-5 w-5 text-primary" />
                  <div>
                    <p className="font-medium">Security Manager</p>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge 
                        variant={connectionStatus.csm === 'connected' ? 'default' : 'secondary'}
                        className={
                          connectionStatus.csm === 'connected' 
                            ? 'bg-success text-success-foreground' 
                            : connectionStatus.csm === 'error'
                            ? 'bg-destructive text-destructive-foreground'
                            : ''
                        }
                      >
                        {connectionStatus.csm === 'connected' ? 'Verbunden' : 
                         connectionStatus.csm === 'connecting' ? 'Verbindet...' :
                         connectionStatus.csm === 'error' ? 'Fehler' : 'Nicht verbunden'}
                      </Badge>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
            
            <Card className="flex-1">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <Network className="h-5 w-5 text-primary" />
                  <div>
                    <p className="font-medium">Firepower Management Center</p>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge 
                        variant={connectionStatus.fmc === 'connected' ? 'default' : 'secondary'}
                        className={
                          connectionStatus.fmc === 'connected' 
                            ? 'bg-success text-success-foreground' 
                            : connectionStatus.fmc === 'error'
                            ? 'bg-destructive text-destructive-foreground'
                            : ''
                        }
                      >
                        {connectionStatus.fmc === 'connected' ? 'Verbunden' : 
                         connectionStatus.fmc === 'connecting' ? 'Verbindet...' :
                         connectionStatus.fmc === 'error' ? 'Fehler' : 'Nicht verbunden'}
                      </Badge>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        <Tabs defaultValue="connection" className="space-y-6">
          <TabsList className="grid w-full grid-cols-5 lg:grid-cols-5">
            <TabsTrigger value="connection" className="flex items-center gap-2">
              <Settings className="h-4 w-4" />
              Verbindung
            </TabsTrigger>
            <TabsTrigger value="selection" className="flex items-center gap-2">
              <Shield className="h-4 w-4" />
              Auswahl
            </TabsTrigger>
            <TabsTrigger value="data" className="flex items-center gap-2">
              <Cpu className="h-4 w-4" />
              Daten
            </TabsTrigger>
            <TabsTrigger value="migration" className="flex items-center gap-2">
              <ArrowRightLeft className="h-4 w-4" />
              Migration
            </TabsTrigger>
            <TabsTrigger value="logs" className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Logs
            </TabsTrigger>
          </TabsList>

          <TabsContent value="connection" className="space-y-6">
            <ConnectionPanel
              csmConnection={csmConnection}
              fmcConnection={fmcConnection}
              connectionStatus={connectionStatus}
              onCsmConnectionChange={setCsmConnection}
              onFmcConnectionChange={setFmcConnection}
              onStatusChange={setConnectionStatus}
              addLog={addLog}
            />
          </TabsContent>

          <TabsContent value="selection" className="space-y-6">
            <SelectionPanel
              exportSelection={exportSelection}
              onSelectionChange={setExportSelection}
              connectionStatus={connectionStatus}
              addLog={addLog}
            />
          </TabsContent>

          <TabsContent value="data" className="space-y-6">
            <DataPanel
              networkObjects={networkObjects}
              serviceObjects={serviceObjects}
              accessLists={accessLists}
              onNetworkObjectsChange={setNetworkObjects}
              onServiceObjectsChange={setServiceObjects}
              onAccessListsChange={setAccessLists}
              exportSelection={exportSelection}
              csmConnection={csmConnection}
              addLog={addLog}
            />
          </TabsContent>

          <TabsContent value="migration" className="space-y-6">
            <MigrationPanel
              networkObjects={networkObjects}
              accessLists={accessLists}
              connectionStatus={connectionStatus}
              addLog={addLog}
            />
          </TabsContent>

          <TabsContent value="logs" className="space-y-6">
            <LogPanel logs={logs} onClearLogs={() => setLogs([])} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

export default CiscoMigrationTool;