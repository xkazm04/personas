import { Monitor, Plug, ArrowLeft, Bot, MessageSquare } from 'lucide-react';
import { ThemedConnectorIcon } from '@/features/shared/components/display/ConnectorMeta';
import type { ConnectorDefinition } from '@/lib/types/types';
import type { AutoCredMode } from '../helpers/types';

interface DesktopBridgeBlockProps {
  connector: ConnectorDefinition;
  onCancel: () => void;
}

export function DesktopBridgeBlock({ connector, onCancel }: DesktopBridgeBlockProps) {
  return (
    <div
      className="animate-fade-slide-in bg-secondary/40 backdrop-blur-sm border border-orange-500/15 rounded-xl p-6 space-y-4"
    >
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center border bg-orange-500/10 border-orange-500/20">
          <Monitor className="w-5 h-5 text-orange-400" />
        </div>
        <div className="flex-1">
          <h4 className="font-medium text-foreground">{connector.label} is a desktop app</h4>
          <p className="text-sm text-muted-foreground/80">
            This connector uses a local desktop bridge, not an online API. Use the Desktop Apps panel to detect and connect it.
          </p>
        </div>
      </div>
      <div className="flex gap-2">
        <button
          onClick={onCancel}
          className="px-4 py-2 text-sm font-medium text-muted-foreground/80 bg-secondary/30 rounded-lg hover:bg-secondary/50 transition-colors"
        >
          Back
        </button>
      </div>
    </div>
  );
}

interface SetupHeaderProps {
  connector: ConnectorDefinition;
  mode: AutoCredMode;
  phase: string;
  onCancel: () => void;
}

export function SetupHeader({ connector, mode, phase, onCancel }: SetupHeaderProps) {
  return (
    <div className="flex items-center gap-3">
      <button
        onClick={onCancel}
        className="p-1.5 rounded-lg hover:bg-secondary/50 transition-colors"
      >
        <ArrowLeft className="w-4 h-4 text-muted-foreground/60" />
      </button>
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center border"
        style={{
          backgroundColor: `${connector.color}15`,
          borderColor: `${connector.color}30`,
        }}
      >
        {connector.icon_url ? (
          <ThemedConnectorIcon url={connector.icon_url} label={connector.label} color={connector.color} size="w-5 h-5" />
        ) : (
          <Plug className="w-5 h-5" style={{ color: connector.color }} />
        )}
      </div>
      <div className="flex-1">
        <h4 className="font-medium text-foreground">Auto-Setup {connector.label}</h4>
        <p className="text-sm text-muted-foreground/80">
          {phase === 'analyzing' ? 'Analyzing connector setup procedures...' : 'Browser automation will guide credential creation'}
        </p>
      </div>
      {mode === 'guided' ? (
        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-violet-500/10 border border-violet-500/20">
          <MessageSquare className="w-3 h-3 text-violet-400" />
          <span className="text-xs font-medium text-violet-400">Guided</span>
        </div>
      ) : (
        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-cyan-500/10 border border-cyan-500/20">
          <Bot className="w-3 h-3 text-cyan-400" />
          <span className="text-xs font-medium text-cyan-400">Playwright MCP</span>
        </div>
      )}
    </div>
  );
}
