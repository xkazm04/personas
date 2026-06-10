import { useMemo } from 'react';
import { ArrowRight, Play, GitBranch, Zap, AlertTriangle, Workflow, type LucideIcon } from 'lucide-react';
import { getConnectorMeta, ConnectorIcon } from '@/features/shared/components/display/ConnectorMeta';
import { useTranslation } from '@/i18n/useTranslation';
import type { UseCaseFlow, FlowNode } from '@/lib/types/frontendTypes';

interface UseCasesTabProps {
  flows: UseCaseFlow[];
  onViewFlows: () => void;
}

const NODE_ICONS: Partial<Record<FlowNode['type'], { icon: LucideIcon; color: string }>> = {
  action: { icon: Play, color: 'text-sky-400' },
  decision: { icon: GitBranch, color: 'text-amber-400' },
  event: { icon: Zap, color: 'text-purple-400' },
  error: { icon: AlertTriangle, color: 'text-red-400' },
};

/**
 * Linearise a flow graph for digest display: walk edges from the start node
 * preferring default/yes branches, fall back to authored node order. Start
 * and end markers are dropped — the digest shows the work, not the brackets.
 */
function lineariseFlow(flow: UseCaseFlow): FlowNode[] {
  const byId = new Map(flow.nodes.map((n) => [n.id, n]));
  const start = flow.nodes.find((n) => n.type === 'start');
  if (!start) return flow.nodes.filter((n) => n.type !== 'start' && n.type !== 'end');

  const ordered: FlowNode[] = [];
  const seen = new Set<string>();
  let current: FlowNode | undefined = start;
  while (current && !seen.has(current.id) && ordered.length <= flow.nodes.length) {
    seen.add(current.id);
    if (current.type !== 'start' && current.type !== 'end') ordered.push(current);
    const outgoing = flow.edges.filter((e) => e.source === current!.id);
    const nextEdge =
      outgoing.find((e) => e.variant === 'default' || !e.variant) ??
      outgoing.find((e) => e.variant === 'yes') ??
      outgoing[0];
    current = nextEdge ? byId.get(nextEdge.target) : undefined;
  }

  // A branchy graph can leave nodes unvisited — append them so nothing is hidden.
  for (const n of flow.nodes) {
    if (!seen.has(n.id) && n.type !== 'start' && n.type !== 'end') ordered.push(n);
  }
  return ordered;
}

/** Per-flow linear digest of the template's use-case graphs, readable without
 *  leaving the detail modal. The full diagram stays one click away. */
export function UseCasesTab({ flows, onViewFlows }: UseCasesTabProps) {
  const { t } = useTranslation();
  const digests = useMemo(() => flows.map((f) => ({ flow: f, nodes: lineariseFlow(f) })), [flows]);

  return (
    <div className="space-y-4">
      {digests.map(({ flow, nodes }) => (
        <div key={flow.id} className="rounded-modal border border-primary/10 bg-secondary/10 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="typo-body-lg font-semibold text-foreground">{flow.name}</h3>
              {flow.description && (
                <p className="typo-body text-foreground mt-0.5 leading-relaxed">{flow.description}</p>
              )}
            </div>
          </div>

          {nodes.length > 0 && (
            <div className="flex flex-wrap items-center gap-y-2 mt-3">
              {nodes.map((node, i) => {
                const meta = NODE_ICONS[node.type];
                const NodeIcon = meta?.icon ?? Play;
                const connMeta = node.connector ? getConnectorMeta(node.connector) : null;
                return (
                  <span key={node.id} className="inline-flex items-center">
                    {i > 0 && <ArrowRight className="w-3.5 h-3.5 text-foreground mx-1.5 flex-shrink-0" />}
                    <span
                      className="inline-flex items-center gap-1.5 px-2 py-1 rounded-input bg-secondary/40 border border-primary/10 max-w-[260px]"
                      title={node.detail || undefined}
                    >
                      {connMeta ? (
                        <ConnectorIcon meta={connMeta} size="w-3.5 h-3.5" />
                      ) : (
                        <NodeIcon className={`w-3.5 h-3.5 flex-shrink-0 ${meta?.color ?? 'text-sky-400'}`} />
                      )}
                      <span className="typo-caption text-foreground truncate">{node.label}</span>
                    </span>
                  </span>
                );
              })}
            </div>
          )}
        </div>
      ))}

      <button
        onClick={onViewFlows}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-modal typo-body font-medium text-violet-300 bg-violet-500/10 border border-violet-500/20 hover:bg-violet-500/20 transition-colors"
      >
        <Workflow className="w-3.5 h-3.5" />
        {t.templates.detail.open_diagram}
      </button>
    </div>
  );
}
