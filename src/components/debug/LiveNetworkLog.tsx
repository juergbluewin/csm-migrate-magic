import { useEffect, useMemo, useState } from 'react';
import { networkLogger, type NetworkLogEntry, type NetworkLoggerState } from '@/lib/networkLogger';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

export default function LiveNetworkLog() {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<NetworkLoggerState>({ entries: [], enabled: true });
  const [query, setQuery] = useState('');
  const [onlyErrors, setOnlyErrors] = useState(false);

  useEffect(() => {
    return networkLogger.subscribe(setState);
  }, []);

  const filtered = useMemo(() => {
    return state.entries.filter((e) => {
      if (onlyErrors && e.ok) return false;
      if (!query) return true;
      const q = query.toLowerCase();
      return (
        e.url.toLowerCase().includes(q) ||
        e.method.toLowerCase().includes(q) ||
        (e.responseBodyPreview?.toLowerCase().includes(q) ?? false) ||
        (e.requestBodyPreview?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [state.entries, query, onlyErrors]);

  return (
    <div>
      <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button size="sm" variant="secondary" className="shadow">
              LiveLog
              <Badge className="ml-2" variant="outline">{state.entries.length}</Badge>
            </Button>
          </SheetTrigger>
          <SheetContent side="bottom" className="h-[70vh] p-0">
            <SheetHeader className="px-4 py-3">
              <SheetTitle>Live Netzwerk-Log</SheetTitle>
            </SheetHeader>
            <div className="px-4 pb-3 flex items-center gap-2">
              <Input placeholder="Filter (URL, Body, Methode)" value={query} onChange={(e) => setQuery(e.target.value)} />
              <Button variant={onlyErrors ? 'destructive' : 'outline'} size="sm" onClick={() => setOnlyErrors((v) => !v)}>
                Nur Fehler
              </Button>
              <Button variant={state.enabled ? 'outline' : 'secondary'} size="sm" onClick={() => networkLogger.enable(!state.enabled)}>
                {state.enabled ? 'Pause' : 'Fortsetzen'}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => networkLogger.clear()}>Leeren</Button>
            </div>
            <Separator />
            <ScrollArea className="h-[calc(70vh-88px)]">
              <div className="p-4 space-y-3">
                {filtered.map((e) => (
                  <Entry key={e.id + e.timestamp} entry={e} />
                ))}
                {filtered.length === 0 && (
                  <div className="text-sm opacity-70 px-2 py-6">Keine Einträge</div>
                )}
              </div>
            </ScrollArea>
          </SheetContent>
        </Sheet>
      </div>
    </div>
  );
}

function Entry({ entry }: { entry: NetworkLogEntry }) {
  const statusColor = entry.status
    ? entry.status >= 200 && entry.status < 300
      ? 'text-green-600'
      : 'text-red-600'
    : 'text-foreground';

  return (
    <Card className="p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant="outline">{entry.source}</Badge>
        <span className="font-mono">{new Date(entry.timestamp).toLocaleTimeString()}</span>
        <span className="font-semibold">{entry.method}</span>
        <span className={cn('font-mono', statusColor)}>
          {entry.status ?? '-'} {entry.durationMs != null ? `(${entry.durationMs}ms)` : ''}
        </span>
      </div>
      <div className="mt-2 font-mono text-xs break-all">{entry.url}</div>
      {entry.error && <div className="mt-2 text-xs text-red-600">{entry.error}</div>}

      {entry.requestBodyPreview && (
        <div className="mt-3">
          <div className="text-xs opacity-70 mb-1">Request</div>
          <pre className="bg-muted/50 rounded p-2 text-xs overflow-auto max-h-48 whitespace-pre-wrap">{entry.requestBodyPreview}</pre>
        </div>
      )}
      {entry.responseBodyPreview && (
        <div className="mt-3">
          <div className="text-xs opacity-70 mb-1">Response</div>
          <pre className="bg-muted/50 rounded p-2 text-xs overflow-auto max-h-64 whitespace-pre-wrap">{entry.responseBodyPreview}</pre>
        </div>
      )}
    </Card>
  );
}
