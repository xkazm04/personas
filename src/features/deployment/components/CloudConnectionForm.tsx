import { Wifi, Loader2 } from 'lucide-react';

export interface CloudConnectionFormProps {
  isConnected: boolean;
  config: { url: string; is_connected: boolean } | null;
  url: string;
  setUrl: (v: string) => void;
  apiKey: string;
  setApiKey: (v: string) => void;
  isConnecting: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}

export function CloudConnectionForm({
  isConnected,
  config,
  url,
  setUrl,
  apiKey,
  setApiKey,
  isConnecting,
  onConnect,
  onDisconnect,
}: CloudConnectionFormProps) {
  if (isConnected) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3 p-4 rounded-lg bg-emerald-500/5 border border-emerald-500/15">
          <Wifi className="w-5 h-5 text-emerald-400" />
          <div>
            <p className="text-sm font-medium text-emerald-400">Connected</p>
            <p className="text-xs text-muted-foreground/60 mt-0.5">
              Orchestrator: {config?.url}
            </p>
          </div>
        </div>

        <button
          onClick={onDisconnect}
          className="px-4 py-2 text-sm font-medium rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-colors cursor-pointer"
        >
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-md">
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground/60">Orchestrator URL</label>
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://your-orchestrator.example.com"
          className="w-full px-3 py-2 text-sm rounded-lg bg-secondary/40 border border-primary/15 text-foreground/80 placeholder:text-muted-foreground/30 focus:outline-none focus:border-indigo-500/40 transition-colors"
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground/60">API Key</label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="Enter API key"
          className="w-full px-3 py-2 text-sm rounded-lg bg-secondary/40 border border-primary/15 text-foreground/80 placeholder:text-muted-foreground/30 focus:outline-none focus:border-indigo-500/40 transition-colors"
        />
      </div>

      <button
        onClick={onConnect}
        disabled={isConnecting || !url.trim() || !apiKey.trim()}
        className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-indigo-500 text-foreground hover:bg-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
      >
        {isConnecting ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Connecting...
          </>
        ) : (
          'Connect'
        )}
      </button>
    </div>
  );
}
