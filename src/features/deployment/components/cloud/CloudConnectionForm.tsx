import { Wifi, Loader2 } from 'lucide-react';
import { DEPLOYMENT_TOKENS } from '../deploymentTokens';
import { FormField } from '@/features/shared/components/forms/FormField';
import { INPUT_FIELD } from '@/lib/utils/designTokens';

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
      <div className={DEPLOYMENT_TOKENS.panelSpacing}>
        <div className={`flex items-center gap-3 p-4 ${DEPLOYMENT_TOKENS.cardRadius} ${DEPLOYMENT_TOKENS.connectedBg} border ${DEPLOYMENT_TOKENS.connectedBorder}`}>
          <Wifi className="w-5 h-5 text-emerald-400" />
          <div>
            <p className="text-sm font-medium text-emerald-400">Connected</p>
            <p className="text-sm text-muted-foreground/80 mt-0.5">
              Orchestrator: {config?.url}
            </p>
          </div>
        </div>

        <button
          onClick={onDisconnect}
          className="px-4 py-2 text-sm font-medium rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-colors cursor-pointer"
        >
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <div className={`max-w-md ${DEPLOYMENT_TOKENS.panelSpacing}`}>
      <FormField label="Orchestrator URL">
        {(inputProps) => (
          <input
            {...inputProps}
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://your-orchestrator.example.com"
            className={`${INPUT_FIELD} ${isConnecting ? 'border-indigo-500/35 bg-indigo-500/5' : ''}`}
          />
        )}
      </FormField>

      <FormField label="API Key">
        {(inputProps) => (
          <input
            {...inputProps}
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Enter API key"
            className={`${INPUT_FIELD} ${isConnecting ? 'border-indigo-500/35 bg-indigo-500/5' : ''}`}
          />
        )}
      </FormField>

      <button
        onClick={onConnect}
        disabled={isConnecting || !url.trim() || !apiKey.trim()}
        className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl bg-indigo-500 text-foreground hover:bg-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
      >
        {isConnecting ? (
          <span role="status" aria-live="polite" className="inline-flex items-center gap-2">
            <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" />
            <span>Connecting...</span>
            <span className="sr-only">Connecting to cloud orchestrator...</span>
          </span>
        ) : (
          'Connect'
        )}
      </button>
    </div>
  );
}
