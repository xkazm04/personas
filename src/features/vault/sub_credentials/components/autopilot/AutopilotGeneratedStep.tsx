import { Check, Play, Copy, ExternalLink } from 'lucide-react';
import type { GeneratedConnectorResult } from '@/lib/bindings/GeneratedConnectorResult';
import { MethodBadge } from './AutopilotShared';
import { useTranslation } from '@/i18n/useTranslation';

interface AutopilotGeneratedStepProps {
  generatedResult: GeneratedConnectorResult;
  onPlayground: () => void;
  onComplete: () => void;
}

export function AutopilotGeneratedStep({
  generatedResult,
  onPlayground,
  onComplete,
}: AutopilotGeneratedStepProps) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-modal">
        <div className="flex items-center gap-2 mb-2">
          <Check className="w-5 h-5 text-emerald-400" />
          <h4 className="text-sm font-medium text-emerald-400">{t.vault.autopilot.connector_generated}</h4>
        </div>
        <p className="text-sm text-foreground">
          <strong>{generatedResult.connectorLabel}</strong> is now available in your connector catalog
          with {generatedResult.tools.length} tool definitions.
        </p>
      </div>

      {/* Generated Tools */}
      <div className="space-y-2">
        <h4 className="text-xs font-medium text-foreground uppercase tracking-wider">
          Generated Tools ({generatedResult.tools.length})
        </h4>
        <div className="max-h-60 overflow-y-auto space-y-1 rounded-card border border-primary/10 p-2 bg-secondary/15">
          {generatedResult.tools.map((tool) => (
            <div key={tool.toolName} className="flex items-center gap-2 px-2 py-1.5 rounded-input hover:bg-secondary/30">
              <MethodBadge method={tool.method} />
              <span className="text-xs font-mono text-foreground">{tool.path}</span>
              <span className="text-xs text-foreground ml-auto truncate max-w-[200px]">{tool.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Credential Fields */}
      <div className="space-y-2">
        <h4 className="text-xs font-medium text-foreground uppercase tracking-wider">
          Credential Fields
        </h4>
        <div className="flex flex-wrap gap-2">
          {generatedResult.credentialFields.map((field: unknown, i) => {
            const f = field as { key: string; label: string; type: string };
            return (
              <span key={i} className="px-2 py-1 bg-secondary/30 border border-primary/10 rounded text-xs text-foreground">
                {f.label} <span className="text-foreground">({f.type})</span>
              </span>
            );
          })}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={onPlayground}
          className="flex items-center gap-2 px-4 py-2.5 bg-violet-500/15 hover:bg-violet-500/25 border border-violet-500/30 text-violet-400 rounded-card text-sm font-medium transition-all"
        >
          <Play className="w-4 h-4" />
          Open Playground
        </button>
        <button
          onClick={() => {
            navigator.clipboard.writeText(generatedResult.connectorId);
          }}
          className="flex items-center gap-2 px-4 py-2.5 border border-primary/15 text-foreground hover:text-foreground rounded-card text-sm transition-colors"
        >
          <Copy className="w-4 h-4" />
          Copy Connector ID
        </button>
        <button
          onClick={onComplete}
          className="flex items-center gap-2 px-4 py-2.5 bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-400 rounded-card text-sm font-medium transition-all ml-auto"
        >
          <ExternalLink className="w-4 h-4" />
          Go to Catalog
        </button>
      </div>
    </div>
  );
}
