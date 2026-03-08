import { useMemo } from 'react';
import { SelectionCheckbox } from '../review/SelectionCheckbox';
import { ConnectorIcon, getConnectorMeta } from '@/features/shared/components/ConnectorMeta';
import type { FlowNode, UseCaseFlow } from '@/lib/types/frontendTypes';

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

function buildHumanSummary(nodeCounts: Record<string, number>): string {
  const parts: string[] = [];
  const steps = (nodeCounts['action'] ?? 0) + (nodeCounts['decision'] ?? 0);
  const connectors = nodeCounts['connector'] ?? 0;
  if (steps > 0) parts.push(`${steps} step${steps !== 1 ? 's' : ''}`);
  if (connectors > 0) parts.push(`${connectors} connector${connectors !== 1 ? 's' : ''}`);
  return parts.join(', ');
}

interface UseCaseRowProps {
  flow: UseCaseFlow;
  checked: boolean;
  onToggle: () => void;
  connectorFlowIndex: Map<string, Set<string>>;
  selectedIds: Set<string>;
}

export function UseCaseRow({
  flow,
  checked,
  onToggle,
  connectorFlowIndex,
  selectedIds,
}: UseCaseRowProps) {
  const nodeCounts = useMemo(() => countNodeTypes(flow.nodes), [flow.nodes]);
  const connectors = useMemo(() => uniqueConnectors(flow.nodes), [flow.nodes]);
  const humanSummary = useMemo(() => buildHumanSummary(nodeCounts), [nodeCounts]);

  // Derive shared connector highlighting from the index
  const sharedConnectors = useMemo(() => {
    const shared = new Set<string>();
    for (const conn of connectors) {
      const users = connectorFlowIndex.get(conn);
      if (users && users.size > 1) shared.add(conn);
    }
    return shared;
  }, [connectors, connectorFlowIndex]);

  // Derive which OTHER flows share connectors with this one
  const hasDepHighlight = useMemo(() => {
    if (sharedConnectors.size === 0) return false;
    for (const conn of sharedConnectors) {
      const users = connectorFlowIndex.get(conn);
      if (users) {
        for (const id of users) {
          if (id !== flow.id && selectedIds.has(id)) return true;
        }
      }
    }
    return false;
  }, [sharedConnectors, connectorFlowIndex, flow.id, selectedIds]);

  const description = (flow as UseCaseFlow & { description?: string }).description;

  return (
    <div
      role="checkbox"
      aria-checked={checked}
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggle();
        }
      }}
      className={`flex items-center gap-3 px-3 py-2 rounded-xl border cursor-pointer focus-visible:ring-2 focus-visible:ring-violet-500/40 focus-visible:outline-none group ${
        checked
          ? 'border-violet-500/25 bg-violet-500/5'
          : 'border-primary/10 bg-secondary/15 opacity-60'
      } ${hasDepHighlight ? 'ring-1 ring-emerald-500/30 bg-emerald-500/[0.03]' : ''}`}
    >
      <SelectionCheckbox checked={checked} onChange={onToggle} />

      {/* Name + optional description */}
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium text-foreground block truncate">
          {flow.name}
        </span>
        {description && (
          <span className="text-sm text-muted-foreground/50 block truncate">
            {description}
          </span>
        )}
      </div>

      {/* Connector icons */}
      {connectors.length > 0 && (
        <div className="flex items-center gap-1 flex-shrink-0">
          {connectors.map((name) => {
            const meta = getConnectorMeta(name);
            const isShared = sharedConnectors.has(name);
            return (
              <span
                key={name}
                title={meta.label}
                className={`inline-flex items-center rounded-[4px] p-0.5 border ${
                  isShared
                    ? 'border-emerald-500/30 bg-emerald-500/10'
                    : 'border-transparent'
                }`}
              >
                <ConnectorIcon meta={meta} size="w-3.5 h-3.5" />
              </span>
            );
          })}
        </div>
      )}

      {/* Human-readable summary */}
      {humanSummary && (
        <span className="text-sm text-muted-foreground/60 flex-shrink-0 hidden sm:inline">
          {humanSummary}
        </span>
      )}
    </div>
  );
}
