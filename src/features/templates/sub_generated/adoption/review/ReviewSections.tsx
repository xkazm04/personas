import { Wrench, Zap, Workflow } from 'lucide-react';
import { SelectionCheckbox } from './SelectionCheckbox';
import type { AgentIR } from '@/lib/types/designTypes';
import type { UseCaseFlow } from '@/lib/types/frontendTypes';
import { MOTION } from '@/features/templates/animationPresets';

// Re-export the connector/channel/event sections from the sibling file
export { ConnectorsSection, ChannelsSection, EventsSection } from './ReviewSectionsExtra';

// ---------------------------------------------------------------------------
// Use Cases Section
// ---------------------------------------------------------------------------

export function UseCasesSection({
  useCaseFlows,
  selectedUseCaseIds,
  onToggleUseCaseId,
}: {
  useCaseFlows: UseCaseFlow[];
  selectedUseCaseIds: Set<string>;
  onToggleUseCaseId: (id: string) => void;
}) {
  return (
    <div className="p-4">
      <h4 className="text-sm font-semibold text-muted-foreground/80 uppercase tracking-wider mb-2.5 flex items-center gap-1">
        <Workflow className="w-3 h-3" />
        Use Cases ({useCaseFlows.length})
      </h4>
      <div className="space-y-1.5">
        {useCaseFlows.map((flow) => {
          const isSelected = selectedUseCaseIds.has(flow.id);
          return (
            <div
              key={flow.id}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-xl border transition-all ${MOTION.snappy.css} cursor-pointer hover:bg-primary/5 ${
                isSelected
                  ? 'bg-cyan-500/5 border-cyan-500/15'
                  : 'bg-secondary/20 border-primary/10 opacity-50'
              }`}
              onClick={() => onToggleUseCaseId(flow.id)}
            >
              <SelectionCheckbox
                checked={isSelected}
                onChange={() => onToggleUseCaseId(flow.id)}
              />
              <div className="flex-1 min-w-0">
                <span className={`text-sm font-medium ${isSelected ? 'text-foreground/90' : 'text-muted-foreground/80'}`}>
                  {flow.name}
                </span>
                {flow.description && (
                  <p className={`text-sm truncate ${isSelected ? 'text-foreground/60' : 'text-muted-foreground/60'}`}>
                    {flow.description}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tools Section
// ---------------------------------------------------------------------------

export function ToolsSection({
  tools,
  selectedToolIndices,
  onToggleTool,
}: {
  tools: string[];
  selectedToolIndices: Set<number>;
  onToggleTool: (index: number) => void;
}) {
  return (
    <div className="p-4">
      <h4 className="text-sm font-semibold text-muted-foreground/80 uppercase tracking-wider mb-2.5 flex items-center gap-1">
        <Wrench className="w-3 h-3" />
        Tools ({tools.length})
      </h4>
      <div className="flex flex-wrap gap-2">
        {tools.map((tool, i) => {
          const isSelected = selectedToolIndices.has(i);
          return (
            <div
              key={tool}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl border transition-all ${MOTION.snappy.css} cursor-pointer hover:opacity-80 ${
                isSelected
                  ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                  : 'bg-secondary/30 text-muted-foreground/80 border-primary/10 opacity-60'
              }`}
              onClick={() => onToggleTool(i)}
            >
              <SelectionCheckbox
                checked={isSelected}
                onChange={() => onToggleTool(i)}
              />
              <span className="text-sm font-mono">{tool}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Triggers Section
// ---------------------------------------------------------------------------

export function TriggersSection({
  triggers,
  selectedTriggerIndices,
  onToggleTrigger,
}: {
  triggers: AgentIR['suggested_triggers'];
  selectedTriggerIndices: Set<number>;
  onToggleTrigger: (index: number) => void;
}) {
  return (
    <div className="p-4">
      <h4 className="text-sm font-semibold text-muted-foreground/80 uppercase tracking-wider mb-2.5 flex items-center gap-1">
        <Zap className="w-3 h-3" />
        Triggers ({triggers.length})
      </h4>
      <div className="space-y-2">
        {triggers.map((trigger, i) => {
          const isSelected = selectedTriggerIndices.has(i);
          return (
            <div
              key={i}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-xl border transition-all ${MOTION.snappy.css} cursor-pointer hover:opacity-80 ${
                isSelected
                  ? 'bg-amber-500/5 border-amber-500/15'
                  : 'bg-secondary/20 border-primary/10 opacity-50'
              }`}
              onClick={() => onToggleTrigger(i)}
            >
              <SelectionCheckbox
                checked={isSelected}
                onChange={() => onToggleTrigger(i)}
              />
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
