import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { 
  CheckCircle, 
  XCircle, 
  AlertTriangle, 
  Download, 
  FileText, 
  Clock, 
  Database,
  Shield,
  Hash,
  Eye,
  Copy,
  Save
} from "lucide-react";
import { ExportResult } from "@/lib/csmExportService";
import { useToast } from "@/hooks/use-toast";

interface ExportResultsPanelProps {
  result: ExportResult | null;
  isLoading: boolean;
  onDownload?: (format: string, data: string) => void;
}

export const ExportResultsPanel = ({
  result,
  isLoading,
  onDownload
}: ExportResultsPanelProps) => {
  const [selectedArtifact, setSelectedArtifact] = useState<'raw' | 'transformed'>('transformed');
  const [isArtifactDialogOpen, setIsArtifactDialogOpen] = useState(false);
  const { toast } = useToast();

  const formatDuration = (ms: number): string => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}min`;
  };

  const getStatusIcon = (success: boolean) => {
    return success ? (
      <CheckCircle className="h-5 w-5 text-green-500" />
    ) : (
      <XCircle className="h-5 w-5 text-destructive" />
    );
  };

  const getLevelIcon = (level: string) => {
    switch (level) {
      case 'error':
        return <XCircle className="h-4 w-4 text-destructive" />;
      case 'warn':
        return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
      case 'info':
        return <CheckCircle className="h-4 w-4 text-blue-500" />;
      default:
        return <FileText className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const handleCopyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      toast({
        title: "Kopiert",
        description: "Daten wurden in die Zwischenablage kopiert",
      });
    });
  };

  const handleDownload = (format: string, data: string) => {
    if (onDownload) {
      onDownload(format, data);
    } else {
      // Fallback: Create download link
      const blob = new Blob([data], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `csm-export-${Date.now()}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5 animate-spin" />
            Export läuft...
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <Progress value={65} className="w-full" />
            <p className="text-sm text-muted-foreground">
              Daten werden vom CSM abgerufen und verarbeitet...
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!result) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Export-Ergebnisse</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            Noch kein Export durchgeführt. Konfigurieren Sie einen Export in den vorherigen Tabs.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Export Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              {getStatusIcon(result.success)}
              <div>
                <p className="text-2xl font-bold">
                  {result.success ? 'Erfolg' : 'Fehler'}
                </p>
                <p className="text-sm text-muted-foreground">Export-Status</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <Clock className="h-8 w-8 text-primary" />
              <div>
                <p className="text-2xl font-bold">{formatDuration(result.duration)}</p>
                <p className="text-sm text-muted-foreground">Dauer</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <Database className="h-8 w-8 text-primary" />
              <div>
                <p className="text-2xl font-bold">
                  {result.networkObjectsCount + result.serviceObjectsCount + result.accessRulesCount}
                </p>
                <p className="text-sm text-muted-foreground">Objekte gesamt</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <Shield className="h-8 w-8 text-primary" />
              <div>
                <p className="text-2xl font-bold">
                  {result.consistencyChecks.completeness ? 'OK' : 'Fehler'}
                </p>
                <p className="text-sm text-muted-foreground">Validierung</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Detailed Results */}
      <Tabs defaultValue="summary" className="space-y-4">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="summary">Zusammenfassung</TabsTrigger>
          <TabsTrigger value="artifacts">Artefakte</TabsTrigger>
          <TabsTrigger value="validation">Validierung</TabsTrigger>
          <TabsTrigger value="logs">Protokoll</TabsTrigger>
        </TabsList>

        <TabsContent value="summary">
          <Card>
            <CardHeader>
              <CardTitle>Export-Übersicht</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div>
                    <h4 className="font-medium mb-2">Exportierte Objekte</h4>
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span>Network Objects:</span>
                        <Badge variant="secondary">{result.networkObjectsCount}</Badge>
                      </div>
                      <div className="flex justify-between">
                        <span>Service Objects:</span>
                        <Badge variant="secondary">{result.serviceObjectsCount}</Badge>
                      </div>
                      <div className="flex justify-between">
                        <span>Access Rules:</span>
                        <Badge variant="secondary">{result.accessRulesCount}</Badge>
                      </div>
                    </div>
                  </div>

                  <Separator />

                  <div>
                    <h4 className="font-medium mb-2">Zeitstempel</h4>
                    <div className="space-y-1 text-sm">
                      <p><strong>Start:</strong> {result.timestamp.toLocaleString()}</p>
                      <p><strong>Dauer:</strong> {formatDuration(result.duration)}</p>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <h4 className="font-medium mb-2">Artefakte</h4>
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span>Format:</span>
                        <Badge>{result.artifacts.format.toUpperCase()}</Badge>
                      </div>
                      <div className="flex justify-between items-center">
                        <span>Prüfsumme:</span>
                        <div className="flex items-center gap-1">
                          <Hash className="h-3 w-3" />
                          <code className="text-xs">{result.artifacts.checksum}</code>
                        </div>
                      </div>
                    </div>
                  </div>

                  <Separator />

                  <div>
                    <h4 className="font-medium mb-2">Qualität</h4>
                    <div className="space-y-1 text-sm">
                      <p><strong>Vollständigkeit:</strong> {result.consistencyChecks.completeness ? '✓ OK' : '✗ Fehler'}</p>
                      <p><strong>Encoding:</strong> {result.consistencyChecks.encoding ? '✓ OK' : '✗ Fehler'}</p>
                      <p><strong>Duplikate:</strong> {result.consistencyChecks.duplicates}</p>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="artifacts">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                Export-Artefakte
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsArtifactDialogOpen(true)}
                  >
                    <Eye className="h-4 w-4 mr-1" />
                    Vorschau
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDownload(result.artifacts.format, result.artifacts.transformedData)}
                  >
                    <Download className="h-4 w-4 mr-1" />
                    Download
                  </Button>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">Rohdaten</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        <p className="text-sm text-muted-foreground">
                          Originale XML-Antworten vom CSM
                        </p>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleCopyToClipboard(result.artifacts.rawData)}
                          >
                            <Copy className="h-3 w-3 mr-1" />
                            Kopieren
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleDownload('json', result.artifacts.rawData)}
                          >
                            <Save className="h-3 w-3 mr-1" />
                            Speichern
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">Transformierte Daten</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        <p className="text-sm text-muted-foreground">
                          Verarbeitete Daten im {result.artifacts.format.toUpperCase()}-Format
                        </p>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleCopyToClipboard(result.artifacts.transformedData)}
                          >
                            <Copy className="h-3 w-3 mr-1" />
                            Kopieren
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleDownload(result.artifacts.format, result.artifacts.transformedData)}
                          >
                            <Save className="h-3 w-3 mr-1" />
                            Speichern
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Integrität</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2">
                        <Hash className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm">Prüfsumme:</span>
                        <code className="px-2 py-1 bg-muted rounded text-sm">
                          {result.artifacts.checksum}
                        </code>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleCopyToClipboard(result.artifacts.checksum)}
                      >
                        <Copy className="h-3 w-3 mr-1" />
                        Kopieren
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="validation">
          <Card>
            <CardHeader>
              <CardTitle>Konsistenz- und Validierungsprüfungen</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        {result.consistencyChecks.completeness ? (
                          <CheckCircle className="h-4 w-4 text-green-500" />
                        ) : (
                          <XCircle className="h-4 w-4 text-destructive" />
                        )}
                        Vollständigkeitsprüfung
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground">
                        {result.consistencyChecks.completeness 
                          ? 'Alle erforderlichen Felder sind vorhanden' 
                          : 'Fehlende oder unvollständige Daten erkannt'}
                      </p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        {result.consistencyChecks.encoding ? (
                          <CheckCircle className="h-4 w-4 text-green-500" />
                        ) : (
                          <XCircle className="h-4 w-4 text-destructive" />
                        )}
                        Zeichensatz-Prüfung
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground">
                        {result.consistencyChecks.encoding 
                          ? 'Korrekte UTF-8 Kodierung' 
                          : 'Problematische Zeichen erkannt'}
                      </p>
                    </CardContent>
                  </Card>
                </div>

                {result.consistencyChecks.duplicates > 0 && (
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-yellow-500" />
                        Duplikate
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground">
                        {result.consistencyChecks.duplicates} doppelte Objekt-Namen gefunden
                      </p>
                    </CardContent>
                  </Card>
                )}

                {result.consistencyChecks.errors.length > 0 && (
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <XCircle className="h-4 w-4 text-destructive" />
                        Fehler
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {result.consistencyChecks.errors.map((error, index) => (
                          <div key={index} className="p-2 bg-destructive/10 rounded text-sm">
                            {error}
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {result.consistencyChecks.warnings.length > 0 && (
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-yellow-500" />
                        Warnungen
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {result.consistencyChecks.warnings.map((warning, index) => (
                          <div key={index} className="p-2 bg-yellow-50 border border-yellow-200 rounded text-sm">
                            {warning}
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="logs">
          <Card>
            <CardHeader>
              <CardTitle>Export-Protokoll</CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-96">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-20">Level</TableHead>
                      <TableHead className="w-32">Zeit</TableHead>
                      <TableHead>Nachricht</TableHead>
                      <TableHead className="w-24">Operation</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.logs.map((log, index) => (
                      <TableRow key={index}>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            {getLevelIcon(log.level)}
                            <Badge variant={
                              log.level === 'error' ? 'destructive' :
                              log.level === 'warn' ? 'secondary' :
                              'outline'
                            }>
                              {log.level}
                            </Badge>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs">
                          {log.timestamp.toLocaleTimeString()}
                        </TableCell>
                        <TableCell>
                          <div>
                            <p className="font-medium">{log.message}</p>
                            {log.details && (
                              <p className="text-xs text-muted-foreground mt-1">{log.details}</p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {log.operationId}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Artifact Preview Dialog */}
      <Dialog open={isArtifactDialogOpen} onOpenChange={setIsArtifactDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>Artefakt-Vorschau</DialogTitle>
            <DialogDescription>
              Vorschau der exportierten Daten
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="flex gap-2">
              <Button
                variant={selectedArtifact === 'transformed' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSelectedArtifact('transformed')}
              >
                Transformiert ({result.artifacts.format.toUpperCase()})
              </Button>
              <Button
                variant={selectedArtifact === 'raw' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSelectedArtifact('raw')}
              >
                Rohdaten (JSON)
              </Button>
            </div>
            
            <ScrollArea className="h-96 w-full border rounded">
              <Textarea
                value={selectedArtifact === 'raw' ? result.artifacts.rawData : result.artifacts.transformedData}
                readOnly
                className="min-h-96 font-mono text-xs"
              />
            </ScrollArea>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};