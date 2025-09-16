import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { AlertCircle, Database, Server, List, Terminal } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ConnectionStatus, ExportSelection, LogEntry } from "../CiscoMigrationTool";

interface SelectionPanelProps {
  exportSelection: ExportSelection;
  onSelectionChange: (selection: ExportSelection) => void;
  connectionStatus: ConnectionStatus;
  addLog: (level: LogEntry['level'], message: string, details?: string) => void;
}

export const SelectionPanel = ({ 
  exportSelection, 
  onSelectionChange, 
  connectionStatus,
  addLog 
}: SelectionPanelProps) => {
  const updateSelection = (updates: Partial<ExportSelection>) => {
    const newSelection = { ...exportSelection, ...updates };
    onSelectionChange(newSelection);
    addLog('info', 'Export-Auswahl aktualisiert', JSON.stringify(updates, null, 2));
  };

  const cliCommands = [
    { value: 'show access-list', label: 'show access-list (ASA/PIX)' },
    { value: 'show run object', label: 'show run object' },
    { value: 'show run service-policy', label: 'show run service-policy' },
    { value: 'show run object-group', label: 'show run object-group' },
    { value: 'show service-policy global', label: 'show service-policy global' }
  ];

  const isConnected = connectionStatus.csm === 'connected';

  return (
    <div className="space-y-6">
      {!isConnected && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Bitte stellen Sie zuerst eine Verbindung zum CSM her, um die Export-Optionen zu konfigurieren.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        {/* Objekt-Typen Auswahl */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-5 w-5 text-primary" />
              Objekt-Typen
            </CardTitle>
            <CardDescription>
              Wählen Sie die zu exportierenden Objekt-Typen aus
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="networkObjects"
                  checked={exportSelection.networkObjects}
                  onCheckedChange={(checked) => 
                    updateSelection({ networkObjects: checked as boolean })
                  }
                />
                <Label htmlFor="networkObjects" className="flex items-center gap-2">
                  <Server className="h-4 w-4" />
                  Network Objects
                </Label>
              </div>
              
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="serviceObjects"
                  checked={exportSelection.serviceObjects}
                  onCheckedChange={(checked) => 
                    updateSelection({ serviceObjects: checked as boolean })
                  }
                />
                <Label htmlFor="serviceObjects" className="flex items-center gap-2">
                  <List className="h-4 w-4" />
                  Service Objects
                </Label>
              </div>
              
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="accessLists"
                  checked={exportSelection.accessLists}
                  onCheckedChange={(checked) => 
                    updateSelection({ accessLists: checked as boolean })
                  }
                />
                <Label htmlFor="accessLists" className="flex items-center gap-2">
                  <Terminal className="h-4 w-4" />
                  Access Control Lists (ACLs)
                </Label>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ACL-Quelle Auswahl */}
        <Card>
          <CardHeader>
            <CardTitle>ACL-Quelle</CardTitle>
            <CardDescription>
              Konfiguration für den Abruf von Access Control Lists
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              <Label>Datenquelle</Label>
              <RadioGroup
                value={exportSelection.aclSource}
                onValueChange={(value) => 
                  updateSelection({ aclSource: value as 'policy' | 'cli' })
                }
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="policy" id="policy" />
                  <Label htmlFor="policy">Strukturiert (Policy)</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="cli" id="cli" />
                  <Label htmlFor="cli">CLI ("show access-list")</Label>
                </div>
              </RadioGroup>
            </div>

            {exportSelection.aclSource === 'policy' && (
              <div className="space-y-3 pt-3 border-t">
                <div className="space-y-2">
                  <Label htmlFor="policyName">
                    Policy Name
                    <Badge variant="outline" className="ml-2 text-xs">
                      oft: --local--
                    </Badge>
                  </Label>
                  <Input
                    id="policyName"
                    placeholder="z.B. --local-- oder SharedAccessPolicy"
                    value={exportSelection.policyName || ''}
                    onChange={(e) => updateSelection({ policyName: e.target.value })}
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="deviceGid">Device GID (optional)</Label>
                  <Input
                    id="deviceGid"
                    placeholder="Geräte-Identifikator"
                    value={exportSelection.deviceGid || ''}
                    onChange={(e) => updateSelection({ deviceGid: e.target.value })}
                  />
                </div>
              </div>
            )}

            {exportSelection.aclSource === 'cli' && (
              <div className="space-y-3 pt-3 border-t">
                <div className="space-y-2">
                  <Label htmlFor="deviceIp">Geräte-IP</Label>
                  <Input
                    id="deviceIp"
                    placeholder="192.168.1.1"
                    value={exportSelection.deviceIp || ''}
                    onChange={(e) => updateSelection({ deviceIp: e.target.value })}
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="cliCommand">CLI-Befehl</Label>
                  <Select
                    value={exportSelection.cliCommand}
                    onValueChange={(value) => updateSelection({ cliCommand: value })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="CLI-Befehl auswählen" />
                    </SelectTrigger>
                    <SelectContent>
                      {cliCommands.map((cmd) => (
                        <SelectItem key={cmd.value} value={cmd.value}>
                          {cmd.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Zusammenfassung */}
      <Card>
        <CardHeader>
          <CardTitle>Export-Konfiguration</CardTitle>
          <CardDescription>
            Überprüfen Sie Ihre Auswahl vor dem Export
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <h4 className="font-medium mb-2">Ausgewählte Objekt-Typen:</h4>
              <div className="flex gap-2 flex-wrap">
                {exportSelection.networkObjects && (
                  <Badge variant="secondary">Network Objects</Badge>
                )}
                {exportSelection.serviceObjects && (
                  <Badge variant="secondary">Service Objects</Badge>
                )}
                {exportSelection.accessLists && (
                  <Badge variant="secondary">Access Lists</Badge>
                )}
              </div>
            </div>
            
            {exportSelection.accessLists && (
              <div>
                <h4 className="font-medium mb-2">ACL-Konfiguration:</h4>
                <div className="space-y-1 text-sm text-muted-foreground">
                  <p><strong>Quelle:</strong> {exportSelection.aclSource === 'policy' ? 'Strukturiert (Policy)' : 'CLI'}</p>
                  {exportSelection.aclSource === 'policy' && (
                    <>
                      {exportSelection.policyName && (
                        <p><strong>Policy Name:</strong> {exportSelection.policyName}</p>
                      )}
                      {exportSelection.deviceGid && (
                        <p><strong>Device GID:</strong> {exportSelection.deviceGid}</p>
                      )}
                    </>
                  )}
                  {exportSelection.aclSource === 'cli' && (
                    <>
                      {exportSelection.deviceIp && (
                        <p><strong>Geräte-IP:</strong> {exportSelection.deviceIp}</p>
                      )}
                      {exportSelection.cliCommand && (
                        <p><strong>Befehl:</strong> {exportSelection.cliCommand}</p>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};