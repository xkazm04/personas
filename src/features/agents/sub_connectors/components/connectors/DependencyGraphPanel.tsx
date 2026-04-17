import { useState, useMemo, useCallback } from 'react';
import { Key, Wrench, Zap, ArrowRight, Shield, X, AlertTriangle, CheckCircle2, HelpCircle } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { DepGraph, DepNode, DepNodeKind, DepBlastRadius } from '../../libs/dependencyGraph';
import { analyzeDepBlastRadius } from '../../libs/dependencyGraph';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const KIND_ICONS: Record<DepNodeKind, typeof Key> = {
  credential: Key,
  tool: Wrench,
  automation: Zap,
};

const SEVERITY_STYLES = {
  low: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/20' },
  medium: { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/20' },
  high: { bg: 'bg-red-500/10', text: 'text-red-400', border: 'border-red-500/20' },
} as const;

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function HealthIndicator({ healthy }: { healthy: boolean | null }) {
  if (healthy === null) return <HelpCircle className="w-3 h-3 text-foreground flex-shrink-0" />;
  return healthy
    ? <CheckCircle2 className="w-3 h-3 text-emerald-400 flex-shrink-0" />
    : <AlertTriangle className="w-3 h-3 text-red-400 flex-shrink-0" />;
}

function GraphNodeChip({
  node,
  isSelected,
  onClick,
  edgeCount,
  brokenCount,
}: {
  node: DepNode;
  isSelected: boolean;
  onClick: () => void;
  edgeCount: number;
  brokenCount: number;
}) {
  const Icon = KIND_ICONS[node.kind];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-card text-left transition-colors cursor-pointer ${
        isSelected
          ? 'bg-primary/10 border border-primary/25'
          : 'hover:bg-secondary/40 border border-transparent'
      }`}
    >
      <div
        className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0"
        style={{ background: `${node.color}20`, border: `1px solid ${node.color}40` }}
      >
        <Icon className="w-3 h-3" style={{ color: node.color }} />
      </div>
      <span className="text-xs text-foreground truncate flex-1">{node.label}</span>
      {edgeCount > 0 && (
        <span className="text-xs text-foreground">{edgeCount} dep{edgeCount !== 1 ? 's' : ''}</span>
      )}
      {brokenCount > 0 && (
        <span className="text-xs text-red-400/70">{brokenCount}</span>
      )}
      <HealthIndicator healthy={node.healthy} />
    </button>
  );
}

function BlastPanel({ blast, onClose }: { blast: DepBlastRadius; onClose: () => void }) {
  const { t, tx } = useTranslation();
  const sev = SEVERITY_STYLES[blast.severity];
  const sevLabel = blast.severity === 'low' ? t.agents.connectors.dg_low_risk
    : blast.severity === 'medium' ? t.agents.connectors.dg_medium_risk
    : t.agents.connectors.dg_high_risk;
  return (
    <div
      className="animate-fade-slide-in rounded-modal border border-primary/15 bg-secondary/30 overflow-hidden"
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-primary/10">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-foreground" />
          <span className="text-sm font-medium text-foreground/85">{t.agents.connectors.dg_blast_radius}</span>
        </div>
        <button type="button" onClick={onClose} className="p-1 hover:bg-secondary/50 rounded transition-colors cursor-pointer">
          <X className="w-3.5 h-3.5 text-foreground" />
        </button>
      </div>
      <div className="p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Key className="w-3.5 h-3.5 text-foreground" />
            <span className="text-sm font-medium text-foreground">{blast.credentialName}</span>
            <HealthIndicator healthy={blast.healthy} />
          </div>
          <span className={`px-2 py-0.5 text-xs font-medium rounded-card border ${sev.bg} ${sev.text} ${sev.border}`}>
            {sevLabel}
          </span>
        </div>

        <div className="text-xs text-foreground leading-relaxed">
          {blast.severity === 'high' ? (
            <span>{tx(t.agents.connectors.dg_high_blast, { count: blast.affectedTools.length + blast.affectedAutomations.length })}</span>
          ) : blast.severity === 'medium' ? (
            <span>{tx(t.agents.connectors.dg_medium_blast, { count: blast.affectedTools.length + blast.affectedAutomations.length })}</span>
          ) : (
            <span>{t.agents.connectors.dg_low_blast}</span>
          )}
        </div>

        {blast.affectedTools.length > 0 && (
          <div>
            <div className="text-xs font-medium text-foreground mb-1.5">{t.agents.connectors.dg_affected_tools}</div>
            <div className="space-y-1">
              {blast.affectedTools.map((t) => (
                <div key={t.id} className="flex items-center gap-2 px-2 py-1 rounded-card bg-secondary/30 border border-primary/8">
                  <Wrench className="w-3 h-3 text-blue-400/60" />
                  <span className="text-xs text-foreground truncate">{t.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {blast.affectedAutomations.length > 0 && (
          <div>
            <div className="text-xs font-medium text-foreground mb-1.5">{t.agents.connectors.dg_affected_auto}</div>
            <div className="space-y-1">
              {blast.affectedAutomations.map((a) => (
                <div key={a.id} className="flex items-center gap-2 px-2 py-1 rounded-card bg-secondary/30 border border-primary/8">
                  <Zap className="w-3 h-3 text-violet-400/60" />
                  <span className="text-xs text-foreground truncate">{a.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface DependencyGraphPanelProps {
  graph: DepGraph;
}

export function DependencyGraphPanel({ graph }: DependencyGraphPanelProps) {
  const { t, tx } = useTranslation();

  const KIND_LABELS: Record<DepNodeKind, string> = {
    credential: t.common.connectors,
    tool: t.common.tools,
    automation: t.agents.connectors.auto_title,
  };

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [filterKind, setFilterKind] = useState<DepNodeKind | 'all'>('all');

  const handleNodeClick = useCallback((nodeId: string) => {
    setSelectedNodeId((prev) => (prev === nodeId ? null : nodeId));
  }, []);

  const filteredNodes = useMemo(
    () => filterKind === 'all' ? graph.nodes : graph.nodes.filter((n) => n.kind === filterKind),
    [graph.nodes, filterKind],
  );

  const filteredEdges = useMemo(() => {
    const nodeIds = new Set(filteredNodes.map((n) => n.id));
    return graph.edges.filter((e) => nodeIds.has(e.source) || nodeIds.has(e.target));
  }, [filteredNodes, graph.edges]);

  const selectedBlast = useMemo(() => {
    if (!selectedNodeId) return null;
    const node = graph.nodes.find((n) => n.id === selectedNodeId);
    if (!node || node.kind !== 'credential') return null;
    return analyzeDepBlastRadius(selectedNodeId, graph);
  }, [selectedNodeId, graph]);

  const stats = useMemo(() => {
    const counts: Record<DepNodeKind, number> = { credential: 0, tool: 0, automation: 0 };
    for (const n of graph.nodes) counts[n.kind]++;
    return counts;
  }, [graph.nodes]);

  const brokenEdges = useMemo(() => graph.edges.filter((e) => e.broken), [graph.edges]);

  // Count edges and broken edges per node
  const edgeCounts = useMemo(() => {
    const total = new Map<string, number>();
    const broken = new Map<string, number>();
    for (const e of graph.edges) {
      total.set(e.source, (total.get(e.source) ?? 0) + 1);
      total.set(e.target, (total.get(e.target) ?? 0) + 1);
      if (e.broken) {
        broken.set(e.source, (broken.get(e.source) ?? 0) + 1);
        broken.set(e.target, (broken.get(e.target) ?? 0) + 1);
      }
    }
    return { total, broken };
  }, [graph.edges]);

  // Group nodes by kind for display
  const groupedNodes = useMemo(() => {
    const groups: { kind: DepNodeKind; label: string; nodes: DepNode[] }[] = [];
    const kinds: DepNodeKind[] = ['credential', 'tool', 'automation'];
    for (const kind of kinds) {
      const filtered = filteredNodes.filter((n) => n.kind === kind);
      if (filtered.length > 0) {
        groups.push({ kind, label: KIND_LABELS[kind], nodes: filtered });
      }
    }
    return groups;
  }, [filteredNodes]);

  if (graph.nodes.length === 0) {
    return (
      <div className="text-center py-6 text-foreground text-sm">
        {t.agents.connectors.dg_no_deps}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Summary stats row */}
      <div className="flex items-center gap-2 flex-wrap">
        {(Object.keys(KIND_LABELS) as DepNodeKind[]).map((kind) => {
          if (stats[kind] === 0) return null;
          const Icon = KIND_ICONS[kind];
          const active = filterKind === kind;
          return (
            <button
              key={kind}
              type="button"
              onClick={() => setFilterKind(active ? 'all' : kind)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-card border text-xs transition-colors cursor-pointer ${
                active
                  ? 'bg-primary/10 border-primary/25 text-foreground/90'
                  : 'bg-secondary/25 border-primary/10 text-foreground hover:border-primary/20 hover:bg-secondary/40'
              }`}
            >
              <Icon className="w-3 h-3 flex-shrink-0" />
              <span className="font-semibold">{stats[kind]}</span>
              <span>{KIND_LABELS[kind]}</span>
            </button>
          );
        })}
        {brokenEdges.length > 0 && (
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-card border bg-red-500/8 border-red-500/20 text-xs text-red-400">
            <AlertTriangle className="w-3 h-3" />
            <span>{tx(t.agents.connectors.dg_broken, { count: brokenEdges.length })}</span>
          </div>
        )}
      </div>

      {/* Graph content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Left: node groups */}
        <div className="lg:col-span-2 space-y-2">
          {groupedNodes.map(({ kind, label, nodes }) => (
            <div key={kind} className="rounded-modal border border-primary/10 bg-secondary/20 p-3">
              <div className="text-xs font-medium text-foreground mb-2">
                {label} ({nodes.length})
              </div>
              <div className="space-y-0.5">
                {nodes.map((node) => (
                  <GraphNodeChip
                    key={node.id}
                    node={node}
                    isSelected={selectedNodeId === node.id}
                    onClick={() => handleNodeClick(node.id)}
                    edgeCount={edgeCounts.total.get(node.id) ?? 0}
                    brokenCount={edgeCounts.broken.get(node.id) ?? 0}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Right: detail / blast radius panel */}
        <div className="space-y-2">
          {selectedBlast ? (
              <BlastPanel
                key={selectedBlast.credentialId}
                blast={selectedBlast}
                onClose={() => setSelectedNodeId(null)}
              />
            ) : selectedNodeId ? (
              <div
                key={selectedNodeId}
                className="animate-fade-slide-in rounded-modal border border-primary/15 bg-secondary/30 overflow-hidden"
              >
                <div className="flex items-center justify-between px-3 py-2 border-b border-primary/10">
                  <span className="text-sm font-medium text-foreground/85">{t.agents.connectors.dg_dependencies}</span>
                  <button type="button" onClick={() => setSelectedNodeId(null)} className="p-1 hover:bg-secondary/50 rounded transition-colors cursor-pointer">
                    <X className="w-3.5 h-3.5 text-foreground" />
                  </button>
                </div>
                <div className="p-3 space-y-1 max-h-[200px] overflow-y-auto">
                  {filteredEdges
                    .filter((e) => e.source === selectedNodeId || e.target === selectedNodeId)
                    .map((edge) => {
                      const otherId = edge.source === selectedNodeId ? edge.target : edge.source;
                      const other = graph.nodes.find((n) => n.id === otherId);
                      if (!other) return null;
                      const OtherIcon = KIND_ICONS[other.kind];
                      return (
                        <button
                          key={edge.id}
                          type="button"
                          onClick={() => handleNodeClick(otherId)}
                          className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-card hover:bg-secondary/40 transition-colors text-left cursor-pointer"
                        >
                          <OtherIcon className="w-3 h-3 flex-shrink-0" style={{ color: other.color }} />
                          <span className="text-xs text-foreground truncate flex-1">{other.label}</span>
                          <span className={`text-xs ${edge.broken ? 'text-red-400/70' : 'text-foreground'}`}>{edge.label}</span>
                          {edge.broken && <AlertTriangle className="w-3 h-3 text-red-400/60" />}
                        </button>
                      );
                    })}
                </div>
              </div>
            ) : (
              <div
                key="empty"
                className="animate-fade-slide-in rounded-modal border border-primary/10 bg-secondary/20 p-6 text-center"
              >
                <Shield className="w-8 h-8 mx-auto mb-2 text-foreground" />
                <p className="text-xs text-foreground">
                  {t.agents.connectors.dg_select_cred}
                </p>
              </div>
            )}

          {/* Relationships */}
          {filteredEdges.length > 0 && (
            <div className="rounded-modal border border-primary/10 bg-secondary/20 p-3">
              <div className="text-xs font-medium text-foreground mb-2">
                {tx(t.agents.connectors.dg_relationships, { count: filteredEdges.length })}
              </div>
              <div className="space-y-1 max-h-[180px] overflow-y-auto">
                {filteredEdges.slice(0, 20).map((edge) => {
                  const src = graph.nodes.find((n) => n.id === edge.source);
                  const tgt = graph.nodes.find((n) => n.id === edge.target);
                  if (!src || !tgt) return null;
                  return (
                    <div
                      key={edge.id}
                      className={`flex items-center gap-1.5 text-xs ${edge.broken ? 'text-red-400/70' : 'text-foreground'}`}
                    >
                      <span className="truncate max-w-[80px]" title={src.label}>{src.label}</span>
                      <ArrowRight className="w-3 h-3 flex-shrink-0 text-foreground" />
                      <span className="text-foreground flex-shrink-0">{edge.label}</span>
                      <ArrowRight className="w-3 h-3 flex-shrink-0 text-foreground" />
                      <span className="truncate max-w-[80px]" title={tgt.label}>{tgt.label}</span>
                      {edge.broken && <AlertTriangle className="w-2.5 h-2.5 text-red-400/60 flex-shrink-0" />}
                    </div>
                  );
                })}
                {filteredEdges.length > 20 && (
                  <div className="text-xs text-foreground pt-1">{tx(t.agents.connectors.dg_more, { count: filteredEdges.length - 20 })}</div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
