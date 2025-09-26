import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Settings, Download, Zap, Shield, Database } from "lucide-react";
import { ExportConfig } from "@/lib/csmExportService";
import { ExportSelection, CSMConnection } from "../CiscoMigrationTool";

interface ExportConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  exportSelection: ExportSelection;
  csmConnection: CSMConnection;
  onExport: (config: ExportConfig) => void;
}

export const ExportConfigDialog = ({
  open,
  onOpenChange,
  exportSelection,
  csmConnection,
  onExport
}: ExportConfigDialogProps) => {
  const [config, setConfig] = useState<Partial<ExportConfig>>({
    format: 'json',
    batchSize: 100,
    maxRetries: 3,
    timeout: 30000,
    parallel: true
  });

  const updateConfig = (updates: Partial<ExportConfig>) => {
    setConfig(prev => ({ ...prev, ...updates }));
  };

  const handleExport = () => {
    const fullConfig: ExportConfig = {
      // Connection settings
      ipAddress: csmConnection.ipAddress,
      username: csmConnection.username,
      password: csmConnection.password,
      verifyTls: csmConnection.verifyTls,
      
      // Export selection
      networkObjects: exportSelection.networkObjects,
      serviceObjects: exportSelection.serviceObjects,
      accessLists: exportSelection.accessLists,
      aclSource: exportSelection.aclSource,
      policyName: exportSelection.policyName,
      deviceGid: exportSelection.deviceGid,
      deviceIp: exportSelection.deviceIp,
      cliCommand: exportSelection.cliCommand,
      
      // Export settings with defaults
      format: config.format || 'json',
      batchSize: config.batchSize || 100,
      maxRetries: config.maxRetries || 3,
      timeout: config.timeout || 30000,
      parallel: config.parallel !== false,
      
      // Filtering (optional)
      filters: config.filters
    };
    
    onExport(fullConfig);
    onOpenChange(false);
  };

  const formatOptions = [
    { value: 'json', label: 'JSON', description: 'Strukturiert, maschinenlesbar' },
    { value: 'xml', label: 'XML', description: 'Cisco-kompatibel, hierarchisch' },
    { value: 'csv', label: 'CSV', description: 'Tabellenformat, Excel-kompatibel' }
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Export-Konfiguration
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-6 md:grid-cols-2">
          {/* Export Format */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Download className="h-4 w-4" />
                Export-Format
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Ausgabeformat</Label>
                <Select value={config.format} onValueChange={(value) => updateConfig({ format: value as 'xml' | 'json' | 'csv' })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {formatOptions.map(option => (
                      <SelectItem key={option.value} value={option.value}>
                        <div>
                          <div className="font-medium">{option.label}</div>
                          <div className="text-sm text-muted-foreground">{option.description}</div>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center space-x-2">
                <Switch
                  id="parallel"
                  checked={config.parallel}
                  onCheckedChange={(checked) => updateConfig({ parallel: checked })}
                />
                <Label htmlFor="parallel">Parallel-Verarbeitung</Label>
              </div>
            </CardContent>
          </Card>

          {/* Performance Settings */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="h-4 w-4" />
                Performance
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Batch-Größe: {config.batchSize}</Label>
                <Slider
                  value={[config.batchSize || 100]}
                  onValueChange={([value]) => updateConfig({ batchSize: value })}
                  max={500}
                  min={10}
                  step={10}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>10</span>
                  <span>500</span>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Max. Wiederholungen: {config.maxRetries}</Label>
                <Slider
                  value={[config.maxRetries || 3]}
                  onValueChange={([value]) => updateConfig({ maxRetries: value })}
                  max={10}
                  min={0}
                  step={1}
                  className="w-full"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="timeout">Timeout (Sekunden)</Label>
                <Input
                  id="timeout"
                  type="number"
                  value={(config.timeout || 30000) / 1000}
                  onChange={(e) => updateConfig({ timeout: parseInt(e.target.value) * 1000 })}
                  min={10}
                  max={300}
                />
              </div>
            </CardContent>
          </Card>

          {/* Security & Validation */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-4 w-4" />
                Sicherheit & Validierung
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Konsistenzprüfung</Label>
                  <Badge variant="secondary">Immer aktiv</Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  Automatische Prüfung auf Vollständigkeit, Referenzen und Duplikate
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Checksummen</Label>
                  <Badge variant="secondary">Aktiviert</Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  Integrität der exportierten Daten wird automatisch verifiziert
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Verschlüsselung</Label>
                  <Badge variant={csmConnection.verifyTls ? "default" : "outline"}>
                    {csmConnection.verifyTls ? "TLS aktiv" : "TLS deaktiviert"}
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Export Summary */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database className="h-4 w-4" />
                Export-Zusammenfassung
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Zu exportierende Objekte:</Label>
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
                <>
                  <Separator />
                  <div className="space-y-1">
                    <Label>ACL-Quelle:</Label>
                    <p className="text-sm">
                      {exportSelection.aclSource === 'policy' ? 'Strukturiert (Policy)' : 'CLI'}
                    </p>
                    {exportSelection.aclSource === 'policy' && exportSelection.policyName && (
                      <p className="text-sm text-muted-foreground">
                        Policy: {exportSelection.policyName}
                      </p>
                    )}
                    {exportSelection.aclSource === 'cli' && exportSelection.deviceIp && (
                      <p className="text-sm text-muted-foreground">
                        Device: {exportSelection.deviceIp}
                      </p>
                    )}
                  </div>
                </>
              )}

              <Separator />
              <div className="space-y-1">
                <Label>Ziel-CSM:</Label>
                <p className="text-sm font-mono">{csmConnection.ipAddress}</p>
                <p className="text-sm text-muted-foreground">
                  Benutzer: {csmConnection.username}
                </p>
              </div>

              <Separator />
              <div className="space-y-1">
                <Label>Geschätzte Dauer:</Label>
                <p className="text-sm text-muted-foreground">
                  {config.parallel ? '5-30 Sekunden' : '30-60 Sekunden'}
                  {' '}(abhängig von der Datenmenge)
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex justify-end gap-2 pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button onClick={handleExport} className="flex items-center gap-2">
            <Download className="h-4 w-4" />
            Export starten
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};