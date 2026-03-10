import { Wrench, Zap, Link } from 'lucide-react';
import type { AgentIR } from '@/lib/types/designTypes';
import { SelectionCheckbox } from './SelectionCheckbox';

interface ToolsSectionProps {
  tools: string[];
  selectedToolIndices?: Set<number>;
  hasSelection: boolean;
  onToggleTool?: (index: number) => void;
}

export function ToolsSection({ tools, selectedToolIndices, hasSelection, onToggleTool }: ToolsSectionProps) {
  if (tools.length === 0) return null;

  return (
    <div className="p-4">
      <h4 className="text-sm font-semibold text-muted-foreground/80 uppercase tracking-wider mb-2.5 flex items-center gap-1">
        <Wrench className="w-3 h-3" />
        Tools ({tools.length})
      </h4>
      <div className="flex flex-wrap gap-2">
        {tools.map((tool, i) => {
          const isSelected = selectedToolIndices?.has(i) ?? true;
          return (
            <div
              key={tool}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl border transition-all duration-150 ${
                isSelected
                  ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                  : 'bg-secondary/30 text-muted-foreground/80 border-primary/10 opacity-60'
              } ${onToggleTool ? 'cursor-pointer hover:opacity-80' : ''}`}
              onClick={() => onToggleTool?.(i)}
            >
              {hasSelection && (
                <SelectionCheckbox
                  checked={isSelected}
                  onChange={() => onToggleTool?.(i)}
                />
              )}
              <span className="text-sm font-mono">{tool}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface TriggersSectionProps {
  triggers: AgentIR['suggested_triggers'];
  selectedTriggerIndices?: Set<number>;
  hasSelection: boolean;
  onToggleTrigger?: (index: number) => void;
}

export function TriggersSection({ triggers, selectedTriggerIndices, hasSelection, onToggleTrigger }: TriggersSectionProps) {
  if (triggers.length === 0) return null;

  return (
    <div className="p-4">
      <h4 className="text-sm font-semibold text-muted-foreground/80 uppercase tracking-wider mb-2.5 flex items-center gap-1">
        <Zap className="w-3 h-3" />
        Triggers ({triggers.length})
      </h4>
      <div className="space-y-2">
        {triggers.map((trigger, i) => {
          const isSelected = selectedTriggerIndices?.has(i) ?? true;
          return (
            <div
              key={i}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-xl border transition-all duration-150 ${
                isSelected
                  ? 'bg-amber-500/5 border-amber-500/15'
                  : 'bg-secondary/20 border-primary/10 opacity-50'
              } ${onToggleTrigger ? 'cursor-pointer hover:opacity-80' : ''}`}
              onClick={() => onToggleTrigger?.(i)}
            >
              {hasSelection && (
                <SelectionCheckbox
                  checked={isSelected}
                  onChange={() => onToggleTrigger?.(i)}
                />
              )}
              <span className={`px-1.5 py-0.5 text-sm font-mono rounded border ${
                isSelected
                  ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                  : 'bg-secondary/30 text-muted-foreground/80 border-primary/10'
              }`}>
                {trigger.trigger_type}
              </span>
              <span className={`text-sm truncate ${isSelected ? 'text-foreground/80' : 'text-muted-foreground/80'}`}>
                {trigger.description}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface ConnectorsSectionProps {
  connectors: NonNullable<AgentIR['suggested_connectors']>;
  selectedConnectorNames?: Set<string>;
  hasSelection: boolean;
  onToggleConnector?: (name: string) => void;
}

export function ConnectorsSection({ connectors, selectedConnectorNames, hasSelection, onToggleConnector }: ConnectorsSectionProps) {
  if (connectors.length === 0) return null;

  return (
    <div className="p-4">
      <h4 className="text-sm font-semibold text-muted-foreground/80 uppercase tracking-wider mb-2.5 flex items-center gap-1">
        <Link className="w-3 h-3" />
        Connectors ({connectors.length})
      </h4>
      <div className="flex flex-wrap gap-2">
        {connectors.map((conn) => {
          const isSelected = selectedConnectorNames?.has(conn.name) ?? true;
          return (
            <div
              key={conn.name}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl border transition-all duration-150 ${
                isSelected
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                  : 'bg-secondary/30 text-muted-foreground/80 border-primary/10 opacity-60'
              } ${onToggleConnector ? 'cursor-pointer hover:opacity-80' : ''}`}
              onClick={() => onToggleConnector?.(conn.name)}
            >
              {hasSelection && (
                <SelectionCheckbox
                  checked={isSelected}
                  onChange={() => onToggleConnector?.(conn.name)}
                />
              )}
              <span className="text-sm font-medium">{conn.name}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
