import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { 
  ArrowRightLeft, 
  Play, 
  CheckCircle, 
  AlertCircle, 
  Upload,
  Database,
  List,
  Shield,
  Network,
  Clock,
  AlertTriangle
} from "lucide-react";
import { NetworkObject, AccessList, ConnectionStatus, LogEntry } from "../CiscoMigrationTool";

interface MigrationPanelProps {
  networkObjects: NetworkObject[];
  accessLists: AccessList[];
  connectionStatus: ConnectionStatus;
  addLog: (level: LogEntry['level'], message: string, details?: string) => void;
}

interface MigrationTask {
  id: string;
  type: 'networkObject' | 'accessList';
  name: string;
  firewall?: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  progress: number;
  selected: boolean;
}

export const MigrationPanel = ({
  networkObjects,
  accessLists,
  connectionStatus,
  addLog
}: MigrationPanelProps) => {
  const [migrationTasks, setMigrationTasks] = useState<MigrationTask[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [overallProgress, setOverallProgress] = useState(0);

  // Initialize migration tasks when data is available
  useState(() => {
    const tasks: MigrationTask[] = [
      ...networkObjects.map(obj => ({
        id: `obj-${obj.id}`,
        type: 'networkObject' as const,
        name: obj.name,
        firewall: obj.firewall,
        status: 'pending' as const,
        progress: 0,
        selected: true
      })),
      ...accessLists.map(list => ({
        id: `list-${list.id}`,
        type: 'accessList' as const,
        name: list.name,
        firewall: list.firewall,
        status: 'pending' as const,
        progress: 0,
        selected: true
      }))
    ];
    setMigrationTasks(tasks);
  });

  const canStartMigration = () => {
    return connectionStatus.csm === 'connected' && 
           connectionStatus.fmc === 'connected' && 
           migrationTasks.some(task => task.selected) &&
           !isRunning;
  };

  const selectedTasks = migrationTasks.filter(task => task.selected);
  const completedTasks = migrationTasks.filter(task => task.status === 'completed');
  const errorTasks = migrationTasks.filter(task => task.status === 'error');

  const toggleTaskSelection = (taskId: string) => {
    setMigrationTasks(prev => 
      prev.map(task => 
        task.id === taskId ? { ...task, selected: !task.selected } : task
      )
    );
  };

  const toggleAllTasks = (checked: boolean) => {
    setMigrationTasks(prev => 
      prev.map(task => ({ ...task, selected: checked }))
    );
  };

  const startMigration = async () => {
    if (!canStartMigration()) return;

    setIsRunning(true);
    setOverallProgress(0);
    addLog('info', 'Migration gestartet', `Starte Migration von ${selectedTasks.length} Elementen`);

    const tasksToProcess = migrationTasks.filter(task => task.selected);
    let completedCount = 0;

    for (const task of tasksToProcess) {
      // Update task status to running
      setMigrationTasks(prev => 
        prev.map(t => t.id === task.id ? { ...t, status: 'running', progress: 0 } : t)
      );

      addLog('info', `Migration: ${task.name}`, `Übertrage ${task.type === 'networkObject' ? 'Netzwerkobjekt' : 'Access-Liste'} ${task.name}`);

      // Simulate migration process with progress updates
      for (let progress = 0; progress <= 100; progress += 20) {
        await new Promise(resolve => setTimeout(resolve, 200));
        setMigrationTasks(prev => 
          prev.map(t => t.id === task.id ? { ...t, progress } : t)
        );
      }

      // Simulate success/failure (90% success rate)
      const success = Math.random() > 0.1;
      const newStatus = success ? 'completed' : 'error';
      
      setMigrationTasks(prev => 
        prev.map(t => t.id === task.id ? { ...t, status: newStatus, progress: 100 } : t)
      );

      if (success) {
        addLog('success', `Migration erfolgreich: ${task.name}`, `${task.type === 'networkObject' ? 'Netzwerkobjekt' : 'Access-Liste'} erfolgreich übertragen`);
      } else {
        addLog('error', `Migration fehlgeschlagen: ${task.name}`, 'Überprüfen Sie die Zielkonfiguration');
      }

      completedCount++;
      setOverallProgress((completedCount / tasksToProcess.length) * 100);
    }

    setIsRunning(false);
    addLog('info', 'Migration abgeschlossen', `Migration von ${completedCount} Elementen abgeschlossen`);
  };

  const resetMigration = () => {
    setMigrationTasks(prev => 
      prev.map(task => ({ ...task, status: 'pending', progress: 0 }))
    );
    setOverallProgress(0);
    addLog('info', 'Migration zurückgesetzt', 'Alle Migrationsstatus wurden zurückgesetzt');
  };

  const getTaskIcon = (task: MigrationTask) => {
    if (task.status === 'completed') return <CheckCircle className="h-4 w-4 text-success" />;
    if (task.status === 'error') return <AlertCircle className="h-4 w-4 text-destructive" />;
    if (task.status === 'running') return <Clock className="h-4 w-4 text-warning animate-pulse" />;
    
    return task.type === 'networkObject' 
      ? <Database className="h-4 w-4 text-muted-foreground" />
      : <List className="h-4 w-4 text-muted-foreground" />;
  };

  const getStatusBadge = (status: MigrationTask['status']) => {
    const variants = {
      pending: 'bg-muted text-muted-foreground',
      running: 'bg-warning/10 text-warning border-warning/20',
      completed: 'bg-success/10 text-success border-success/20',
      error: 'bg-destructive/10 text-destructive border-destructive/20'
    };

    const labels = {
      pending: 'Wartend',
      running: 'Läuft',
      completed: 'Fertig',
      error: 'Fehler'
    };

    return (
      <Badge variant="outline" className={variants[status]}>
        {labels[status]}
      </Badge>
    );
  };

  return (
    <div className="space-y-6">
      {/* Connection Status Check */}
      {(connectionStatus.csm !== 'connected' || connectionStatus.fmc !== 'connected') && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Für die Migration müssen beide Systeme verbunden sein. 
            Bitte stellen Sie zuerst die Verbindungen im "Verbindung" Tab her.
          </AlertDescription>
        </Alert>
      )}

      {/* Migration Overview */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/10 rounded-lg">
                <ArrowRightLeft className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{selectedTasks.length}</p>
                <p className="text-sm text-muted-foreground">Ausgewählt</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-success/10 rounded-lg">
                <CheckCircle className="h-5 w-5 text-success" />
              </div>
              <div>
                <p className="text-2xl font-bold">{completedTasks.length}</p>
                <p className="text-sm text-muted-foreground">Erfolgreich</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-destructive/10 rounded-lg">
                <AlertCircle className="h-5 w-5 text-destructive" />
              </div>
              <div>
                <p className="text-2xl font-bold">{errorTasks.length}</p>
                <p className="text-sm text-muted-foreground">Fehler</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-warning/10 rounded-lg">
                <Upload className="h-5 w-5 text-warning" />
              </div>
              <div>
                <p className="text-2xl font-bold">{Math.round(overallProgress)}%</p>
                <p className="text-sm text-muted-foreground">Fortschritt</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Migration Controls */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Migration starten</CardTitle>
              <CardDescription>
                Übertragung der ausgewählten Objekte und Access-Listen zum FMC
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button 
                variant="outline" 
                onClick={resetMigration}
                disabled={isRunning}
              >
                Zurücksetzen
              </Button>
              <Button 
                onClick={startMigration}
                disabled={!canStartMigration()}
                className="flex items-center gap-2"
              >
                <Play className="h-4 w-4" />
                Migration starten
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isRunning && (
            <div className="space-y-2 mb-4">
              <div className="flex items-center justify-between text-sm">
                <span>Gesamtfortschritt</span>
                <span>{Math.round(overallProgress)}%</span>
              </div>
              <Progress value={overallProgress} className="h-2" />
            </div>
          )}

          <div className="flex items-center space-x-2 mb-4">
            <Checkbox
              id="select-all"
              checked={migrationTasks.length > 0 && migrationTasks.every(task => task.selected)}
              onCheckedChange={toggleAllTasks}
              disabled={isRunning}
            />
            <label htmlFor="select-all" className="text-sm font-medium">
              Alle auswählen ({migrationTasks.length} Elemente)
            </label>
          </div>
          
          <Separator className="my-4" />
        </CardContent>
      </Card>

      {/* Migration Tasks List */}
      <Card>
        <CardHeader>
          <CardTitle>Migrationselemente</CardTitle>
          <CardDescription>
            Auswahl und Status der zu migrierenden Objekte und Access-Listen
          </CardDescription>
        </CardHeader>
        <CardContent>
          {migrationTasks.length === 0 ? (
            <div className="text-center py-8">
              <ArrowRightLeft className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">
                Keine Migrationselemente verfügbar. Laden Sie zuerst Daten vom CSM.
              </p>
            </div>
          ) : (
            <ScrollArea className="h-[400px]">
              <div className="space-y-3">
                {migrationTasks.map((task, index) => (
                  <div key={task.id}>
                    <div className="flex items-center space-x-4 p-3 rounded-lg border bg-card/50">
                      <Checkbox
                        checked={task.selected}
                        onCheckedChange={() => toggleTaskSelection(task.id)}
                        disabled={isRunning}
                      />
                      
                      <div className="flex-shrink-0">
                        {getTaskIcon(task)}
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="font-medium truncate">{task.name}</p>
                          {task.firewall && (
                            <Badge variant="outline" className="text-xs">
                              {task.firewall}
                            </Badge>
                          )}
                          <Badge variant="outline" className="text-xs">
                            {task.type === 'networkObject' ? 'Objekt' : 'Access-Liste'}
                          </Badge>
                        </div>
                        
                        {task.status === 'running' && (
                          <div className="space-y-1">
                            <Progress value={task.progress} className="h-1" />
                            <p className="text-xs text-muted-foreground">
                              {task.progress}% übertragen
                            </p>
                          </div>
                        )}
                      </div>
                      
                      <div className="flex-shrink-0">
                        {getStatusBadge(task.status)}
                      </div>
                    </div>
                    
                    {index < migrationTasks.length - 1 && <Separator className="my-2" />}
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* Migration Summary */}
      {(completedTasks.length > 0 || errorTasks.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle>Migrationszusammenfassung</CardTitle>
            <CardDescription>
              Übersicht über die durchgeführten Migrationen
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {completedTasks.length > 0 && (
                <div className="space-y-2">
                  <h4 className="font-medium text-success flex items-center gap-2">
                    <CheckCircle className="h-4 w-4" />
                    Erfolgreich migriert ({completedTasks.length})
                  </h4>
                  <div className="space-y-1">
                    {completedTasks.slice(0, 5).map(task => (
                      <p key={task.id} className="text-sm text-muted-foreground">
                        • {task.name}
                      </p>
                    ))}
                    {completedTasks.length > 5 && (
                      <p className="text-sm text-muted-foreground">
                        ... und {completedTasks.length - 5} weitere
                      </p>
                    )}
                  </div>
                </div>
              )}
              
              {errorTasks.length > 0 && (
                <div className="space-y-2">
                  <h4 className="font-medium text-destructive flex items-center gap-2">
                    <AlertCircle className="h-4 w-4" />
                    Fehlgeschlagen ({errorTasks.length})
                  </h4>
                  <div className="space-y-1">
                    {errorTasks.slice(0, 5).map(task => (
                      <p key={task.id} className="text-sm text-muted-foreground">
                        • {task.name}
                      </p>
                    ))}
                    {errorTasks.length > 5 && (
                      <p className="text-sm text-muted-foreground">
                        ... und {errorTasks.length - 5} weitere
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};