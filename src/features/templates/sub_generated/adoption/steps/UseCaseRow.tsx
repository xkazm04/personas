import { useMemo } from 'react';
import { AlertTriangle, GitFork, Plug, Radio, Wrench } from 'lucide-react';
import { SelectionCheckbox } from '../review/SelectionCheckbox';
import { ConnectorIcon, getConnectorMeta } from '@/features/shared/components/ConnectorMeta';
import type { FlowNode, UseCaseFlow } from '@/lib/types/frontendTypes';
import { MOTION } from '@/features/templates/animationPresets';

const NODE_TYPE_PILLS: Record<string, { Icon: typeof Wrench; color: string; label: string }> = {
  action: { Icon: Wrench, color: 'text-blue-400 bg-blue-500/10 border-blue-500/15', label: 'action' },
  decision: { Icon: GitFork, color: 'text-amber-400 bg-amber-500/10 border-amber-500/15', label: 'decision' },
  connector: { Icon: Plug, color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/15', label: 'connector' },
  event: { Icon: Radio, color: 'text-violet-400 bg-violet-500/10 border-violet-500/15', label: 'event' },
  error: { Icon: AlertTriangle, color: 'text-rose-400 bg-rose-500/10 border-rose-500/15', label: 'error' },
};

function countNodeTypes(nodes: FlowNode[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const n of nodes) {
    if (n.type === 'start' || n.type === 'end') continue;
    counts[n.type] = (counts[n.type] || 0) + 1;
  }
  return counts;
}

export function uniqueConnectors(nodes: FlowNode[]): string[] {
  const seen = new Set<string>();
  for (const n of nodes) {
    if (n.type === 'connector' && n.connector) seen.add(n.connector);
  }
  return Array.from(seen);
}

function buildTypeSummary(nodeCounts: Record<string, number>): string {
  return Object.entries(nodeCounts)
    .map(([type, count]) => {
      const label = NODE_TYPE_PILLS[type]?.label ?? type;
      return `${count} ${label}${count !== 1 ? 's' : ''}`;
    })
    .join(', ');
}

interface UseCaseRowProps {
  flow: UseCaseFlow;
  checked: boolean;
  onToggle: () => void;
  onHover: (flowId: string | null) => void;
  highlightedConnectors: Set<string>;
  isDepHighlighted: boolean;
}

export function UseCaseRow({
  flow,
  checked,
  onToggle,
  onHover,
  highlightedConnectors,
  isDepHighlighted,
}: UseCaseRowProps) {
  const nodeCounts = useMemo(() => countNodeTypes(flow.nodes), [flow.nodes]);
  const connectors = useMemo(() => uniqueConnectors(flow.nodes), [flow.nodes]);
  const typeSummary = useMemo(() => buildTypeSummary(nodeCounts), [nodeCounts]);

  return (
    <div
      role="checkbox"
      aria-checked={checked}
      tabIndex={0}
      onClick={onToggle}
      onMouseEnter={() => onHover(flow.id)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(flow.id)}
      onBlur={() => onHover(null)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggle();
        }
      }}
      title={typeSummary}
      className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border cursor-pointer transition-all focus-visible:ring-2 focus-visible:ring-violet-500/40 focus-visible:outline-none ${MOTION.snappy.css} ${
        checked
          ? 'border-violet-500/25 bg-violet-500/5'
          : 'border-primary/10 bg-secondary/15 opacity-60'
      } ${isDepHighlighted ? 'ring-1 ring-emerald-500/30 bg-emerald-500/[0.03]' : ''}`}
    >
      <SelectionCheckbox checked={checked} onChange={onToggle} />
      <span className="text-sm font-medium text-foreground flex-1 truncate">
        {flow.name}
      </span>

      {connectors.length > 0 && (
        <div className="flex items-center gap-1 flex-shrink-0">
          {connectors.map((name) => {
            const meta = getConnectorMeta(name);
            const isShared = highlightedConnectors.has(name);
            return (
              <span
                key={name}
                title={meta.label}
                className={`inline-flex items-center rounded-[4px] p-0.5 border transition-all ${MOTION.snappy.css} ${
                  isShared
                    ? 'animate-pulse border-emerald-500/30 bg-emerald-500/10'
                    : 'border-transparent'
                }`}
              >
                <ConnectorIcon meta={meta} size="w-3.5 h-3.5" />
              </span>
            );
          })}
        </div>
      )}

      <div className="flex items-center gap-1 flex-shrink-0">
        {Object.entries(nodeCounts).map(([type, count]) => {
          const pill = NODE_TYPE_PILLS[type];
          if (!pill) return null;
          const { Icon, color, label } = pill;
          return (
            <span
              key={type}
              title={`${count} ${label}${count !== 1 ? 's' : ''}`}
              className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-mono rounded border ${color}`}
            >
              <Icon className="w-2.5 h-2.5" />
              {count}
            </span>
          );
        })}
      </div>
    </div>
  );
}
