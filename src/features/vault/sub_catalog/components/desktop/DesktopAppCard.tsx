import { CheckCircle2, ChevronRight, CircleDot } from 'lucide-react';
import { ConnectorIcon, getConnectorMeta } from '@/features/shared/components/display/ConnectorMeta';
import type { DiscoveredApp } from '@/api/system/desktop';

interface DesktopAppCardProps {
  app: DiscoveredApp;
  selected: boolean;
  onSelect: () => void;
  disabled?: boolean;
}

export function DesktopAppCard({ app, selected, onSelect, disabled = false }: DesktopAppCardProps) {
  const meta = getConnectorMeta(app.connector_name);

  return (
    <button
      onClick={onSelect}
      disabled={disabled}
      className={`w-full text-left p-3 rounded-xl border transition-all ${
        disabled
          ? 'opacity-40 cursor-not-allowed border-primary/5 bg-secondary/10'
          : selected
            ? 'border-orange-500/30 bg-orange-500/5'
            : 'border-primary/10 bg-secondary/20 hover:bg-secondary/40 hover:border-primary/20'
      }`}
    >
      <div className="flex items-center gap-3">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center border"
          style={{
            backgroundColor: `${meta.color}15`,
            borderColor: `${meta.color}30`,
          }}
        >
          <ConnectorIcon meta={meta} size="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground">{app.label}</span>
            {app.installed && (
              <span className="flex items-center gap-1 text-xs text-emerald-400">
                <CheckCircle2 className="w-3 h-3" />
                Installed
              </span>
            )}
            {app.running && (
              <span className="flex items-center gap-1 text-xs text-cyan-400">
                <CircleDot className="w-3 h-3" />
                Running
              </span>
            )}
          </div>
          {app.binary_path && (
            <p className="text-xs text-muted-foreground/60 truncate">{app.binary_path}</p>
          )}
        </div>
        {!disabled && <ChevronRight className="w-4 h-4 text-muted-foreground/50" />}
      </div>
    </button>
  );
}
