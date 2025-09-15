import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RotateCcw, Shield, Activity } from "lucide-react";
import { ConnectionStatus } from "../CiscoMigrationTool";

interface HeaderProps {
  connectionStatus: ConnectionStatus;
  onReset: () => void;
}

export const Header = ({ connectionStatus, onReset }: HeaderProps) => {
  const isConnected = connectionStatus.csm === 'connected' || connectionStatus.fmc === 'connected';
  
  return (
    <header className="bg-gradient-to-r from-primary to-primary-hover text-primary-foreground shadow-lg">
      <div className="container mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="p-2 bg-white/10 rounded-lg">
              <Shield className="h-8 w-8" />
            </div>
            <div>
              <h1 className="text-xl font-bold">Cisco Migration Tool</h1>
              <p className="text-primary-foreground/80 text-sm">
                Security Manager → Firepower Management Center
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4" />
              <Badge 
                variant="secondary" 
                className={`${isConnected ? 'bg-success/20 text-success border-success' : 'bg-white/20 text-white border-white/30'}`}
              >
                {isConnected ? 'System aktiv' : 'System bereit'}
              </Badge>
            </div>
            
            <Button 
              variant="secondary" 
              size="sm"
              onClick={onReset}
              className="bg-white/10 text-white border-white/20 hover:bg-white/20"
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              Reset
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
};