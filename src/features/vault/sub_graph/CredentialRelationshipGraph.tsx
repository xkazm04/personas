import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Network, Key, Bot, Zap,
  X, Shield, ArrowRight,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePersonaStore } from '@/stores/personaStore';
import { getCredentialDependents } from '@/api/credentials';
import type { CredentialDependent } from '@/lib/bindings/CredentialDependent';
import {
  buildCredentialGraph,
  analyzeBlastRadius,
  type GraphNode,
  type GraphNodeKind,
  type BlastRadius,
} from './credentialGraph';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const KIND_ICONS: Record<GraphNodeKind, typeof Key> = {
  credential: Key,
  agent: Bot,
  event: Zap,
};

const KIND_LABELS: Record<GraphNodeKind, string> = {
  credential: 'Credentials',
  agent: 'Agents',
  event: 'Events',
};

const SEVERITY_STYLES = {
  low: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/20', label: 'Low Risk' },
  medium: { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/20', label: 'Medium Risk' },
  high: { bg: 'bg-red-500/10', text: 'text-red-400', border: 'border-red-500/20', label: 'High Risk' },
} as const;

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function CredentialRelationshipGraph() {
  const credentials = usePersonaStore((s) => s.credentials);
  const connectorDefinitions = usePersonaStore((s) => s.connectorDefinitions);
  const personas = usePersonaStore((s) => s.personas);
  const credentialEvents = usePersonaStore((s) => s.credentialEvents);
  const fetchCredentialEvents = usePersonaStore((s) => s.fetchCredentialEvents);

  const [dependentsMap, setDependentsMap] = useState<Map<string, CredentialDependent[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [filterKind, setFilterKind] = useState<GraphNodeKind | 'all'>('all');

  // Fetch dependents for all credentials
  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const load = async () => {
      await fetchCredentialEvents();
      const map = new Map<string, CredentialDependent[]>();
      await Promise.all(
        credentials.map(async (cred) => {
          try {
            const deps = await getCredentialDependents(cred.id);
            if (!cancelled) map.set(cred.id, deps);
          } catch {
            if (!cancelled) map.set(cred.id, []);
          }
        }),
      );
      if (!cancelled) {
        setDependentsMap(map);
        setLoading(false);
      }
    };

    if (credentials.length > 0) {
      load();
    } else {
      setLoading(false);
    }

    return () => { cancelled = true; };
  }, [credentials, fetchCredentialEvents]);

  const graph = useMemo(
    () => buildCredentialGraph(credentials, connectorDefinitions, personas, credentialEvents, dependentsMap),
    [credentials, connectorDefinitions, personas, credentialEvents, dependentsMap],
  );

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
    return analyzeBlastRadius(selectedNodeId, graph);
  }, [selectedNodeId, graph]);

  const stats = useMemo(() => {
    const counts: Record<GraphNodeKind, number> = { credential: 0, agent: 0, event: 0 };
    for (const n of graph.nodes) counts[n.kind]++;
    return counts;
  }, [graph.nodes]);

  const handleNodeClick = useCallback((nodeId: string) => {
    setSelectedNodeId((prev) => prev === nodeId ? null : nodeId);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
      </div>
    );
  }

  if (credentials.length === 0) {
    return (
      <div className="text-center py-10 text-muted-foreground/60 text-sm">
        No credentials to graph.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary stats */}
<<<<<<< HEAD
      <div className="grid grid-cols-3 3xl:grid-cols-4 4xl:grid-cols-6 gap-2">
=======
      <div className="grid grid-cols-3 gap-2">
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
        {(Object.keys(KIND_LABELS) as GraphNodeKind[]).map((kind) => {
          const Icon = KIND_ICONS[kind];
          const active = filterKind === kind;
          return (
            <button
              key={kind}
              type="button"
              onClick={() => setFilterKind(active ? 'all' : kind)}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-left transition-colors cursor-pointer ${
                active
                  ? 'bg-primary/10 border-primary/25 text-foreground/90'
                  : 'bg-secondary/25 border-primary/10 text-muted-foreground/70 hover:border-primary/20 hover:bg-secondary/40'
              }`}
            >
              <Icon className="w-3.5 h-3.5 flex-shrink-0" />
              <div>
                <span className="text-lg font-semibold leading-none">{stats[kind]}</span>
                <span className="text-xs ml-1.5">{KIND_LABELS[kind]}</span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Main graph area */}
<<<<<<< HEAD
      <div className="grid grid-cols-1 lg:grid-cols-3 3xl:grid-cols-4 4xl:grid-cols-5 gap-3">
        {/* Left: credential list / filtered node list */}
        <div className="lg:col-span-2 3xl:col-span-3 4xl:col-span-4 space-y-2">
=======
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Left: credential list / filtered node list */}
        <div className="lg:col-span-2 space-y-2">
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
          {/* Credential list */}
          {(filterKind === 'all' || filterKind === 'credential') && (
            <div className="rounded-xl border border-primary/10 bg-secondary/20 p-3">
              <div className="text-xs font-medium text-muted-foreground/60 mb-2">
                Credentials ({graph.nodes.filter((n) => n.kind === 'credential').length})
              </div>
              <div className="space-y-1">
                {graph.nodes
                  .filter((n) => n.kind === 'credential')
                  .map((node) => (
                    <NodeChip
                      key={node.id}
                      node={node}
                      isSelected={selectedNodeId === node.id}
                      onClick={() => handleNodeClick(node.id)}
                      extra={
                        <HealthDot
                          success={
                            credentials.find((c) => c.id === node.id)
                              ?.healthcheck_last_success ?? null
                          }
                        />
                      }
                    />
                  ))}
              </div>
            </div>
          )}

          {/* Filtered node list when filtering by non-credential kind */}
          {filterKind !== 'all' && filterKind !== 'credential' && (
            <div className="rounded-xl border border-primary/10 bg-secondary/20 p-3">
              <div className="text-xs font-medium text-muted-foreground/60 mb-2">
                {KIND_LABELS[filterKind]} ({filteredNodes.length})
              </div>
              <div className="space-y-1">
                {filteredNodes.map((node) => (
                  <NodeChip
                    key={node.id}
                    node={node}
                    isSelected={selectedNodeId === node.id}
                    onClick={() => handleNodeClick(node.id)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right: blast radius / detail panel */}
        <div className="space-y-2">
          <AnimatePresence mode="wait">
            {selectedBlast ? (
              <BlastRadiusPanel
                key={selectedBlast.credentialId}
                blast={selectedBlast}
                onClose={() => setSelectedNodeId(null)}
              />
            ) : selectedNodeId ? (
              <NodeDetailPanel
                key={selectedNodeId}
                node={graph.nodes.find((n) => n.id === selectedNodeId) ?? null}
                edges={graph.edges.filter((e) => e.source === selectedNodeId || e.target === selectedNodeId)}
                allNodes={graph.nodes}
                onClose={() => setSelectedNodeId(null)}
                onNodeClick={handleNodeClick}
              />
            ) : (
              <motion.div
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="rounded-xl border border-primary/10 bg-secondary/20 p-6 text-center"
              >
                <Network className="w-8 h-8 mx-auto mb-2 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground/50">
                  Select a credential to see its blast radius and dependencies
                </p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Edge summary */}
          <div className="rounded-xl border border-primary/10 bg-secondary/20 p-3">
            <div className="text-xs font-medium text-muted-foreground/60 mb-2">
              Relationships ({filteredEdges.length})
            </div>
            <div className="space-y-1 max-h-[200px] overflow-y-auto">
              {filteredEdges.slice(0, 30).map((edge) => {
                const srcNode = graph.nodes.find((n) => n.id === edge.source);
                const tgtNode = graph.nodes.find((n) => n.id === edge.target);
                if (!srcNode || !tgtNode) return null;
                return (
                  <div key={edge.id} className="flex items-center gap-1.5 text-xs text-muted-foreground/70">
                    <span className="truncate max-w-[80px]" title={srcNode.label}>{srcNode.label}</span>
                    <ArrowRight className="w-3 h-3 flex-shrink-0 text-muted-foreground/40" />
                    <span className="text-muted-foreground/50 flex-shrink-0">{edge.label}</span>
                    <ArrowRight className="w-3 h-3 flex-shrink-0 text-muted-foreground/40" />
                    <span className="truncate max-w-[80px]" title={tgtNode.label}>{tgtNode.label}</span>
                  </div>
                );
              })}
              {filteredEdges.length > 30 && (
                <div className="text-xs text-muted-foreground/60 pt-1">
                  +{filteredEdges.length - 30} more
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Node chip
// ---------------------------------------------------------------------------

function NodeChip({
  node,
  isSelected,
  onClick,
  extra,
}: {
  node: GraphNode;
  isSelected: boolean;
  onClick: () => void;
  extra?: React.ReactNode;
}) {
  const Icon = KIND_ICONS[node.kind];

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left transition-colors cursor-pointer ${
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
      <span className="text-xs text-foreground/80 truncate flex-1">{node.label}</span>
      {node.meta.serviceType && (
        <span className="text-xs text-muted-foreground/60 font-mono truncate max-w-[80px]">{node.meta.serviceType}</span>
      )}
      {node.meta.dependentCount != null && node.meta.dependentCount > 0 && (
        <span className="text-xs text-blue-400/60">{node.meta.dependentCount} dep{node.meta.dependentCount !== 1 ? 's' : ''}</span>
      )}
      {extra}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Health dot
// ---------------------------------------------------------------------------

function HealthDot({ success }: { success: boolean | null }) {
  if (success === null) return <div className="w-2 h-2 rounded-full bg-gray-500/40 flex-shrink-0" title="Not tested" />;
  return (
    <div
      className={`w-2 h-2 rounded-full flex-shrink-0 ${success ? 'bg-emerald-400' : 'bg-red-400'}`}
      title={success ? 'Healthy' : 'Unhealthy'}
    />
  );
}

// ---------------------------------------------------------------------------
// Blast radius panel
// ---------------------------------------------------------------------------

function BlastRadiusPanel({ blast, onClose }: { blast: BlastRadius; onClose: () => void }) {
  const sev = SEVERITY_STYLES[blast.severity];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      className="rounded-xl border border-primary/15 bg-secondary/30 overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-primary/10">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-muted-foreground/60" />
          <span className="text-sm font-medium text-foreground/85">Blast Radius</span>
        </div>
        <button type="button" onClick={onClose} className="p-1 hover:bg-secondary/50 rounded transition-colors cursor-pointer">
          <X className="w-3.5 h-3.5 text-muted-foreground/50" />
        </button>
      </div>

      <div className="p-3 space-y-3">
        {/* Credential name + severity */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Key className="w-3.5 h-3.5 text-muted-foreground/60" />
            <span className="text-sm font-medium text-foreground/80">{blast.credentialName}</span>
          </div>
          <span className={`px-2 py-0.5 text-xs font-medium rounded-lg border ${sev.bg} ${sev.text} ${sev.border}`}>
            {sev.label}
          </span>
        </div>

        {/* Impact summary */}
        <div className="text-xs text-muted-foreground/70 leading-relaxed">
          {blast.severity === 'high' ? (
            <span>Removing this credential would impact <strong className="text-red-400">{blast.affectedAgents.length} agents</strong>. Consider rotating instead of deleting.</span>
          ) : blast.severity === 'medium' ? (
            <span>This credential is used by <strong className="text-amber-400">{blast.affectedAgents.length} agent{blast.affectedAgents.length !== 1 ? 's' : ''}</strong>. Review dependencies before changes.</span>
          ) : (
            <span>No agents depend on this credential. Safe to modify or remove.</span>
          )}
        </div>

        {/* Affected agents */}
        {blast.affectedAgents.length > 0 && (
          <div>
            <div className="text-xs font-medium text-muted-foreground/60 mb-1.5">Affected Agents</div>
            <div className="space-y-1">
              {blast.affectedAgents.map((agent) => (
                <div key={agent.id} className="flex items-center gap-2 px-2 py-1 rounded-lg bg-secondary/30 border border-primary/8">
                  <Bot className="w-3 h-3 text-blue-400/60" />
                  <span className="text-xs text-foreground/80 flex-1 truncate">{agent.name}</span>
                  {agent.via && (
                    <span className="text-xs text-muted-foreground/60 font-mono">{agent.via}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Affected events */}
        {blast.affectedEvents.length > 0 && (
          <div>
            <div className="text-xs font-medium text-muted-foreground/60 mb-1.5">Affected Events</div>
            <div className="space-y-1">
              {blast.affectedEvents.map((evt) => (
                <div key={evt.id} className="flex items-center gap-2 px-2 py-1 rounded-lg bg-secondary/30 border border-primary/8">
                  <Zap className="w-3 h-3 text-amber-400/60" />
                  <span className="text-xs text-foreground/80 truncate">{evt.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Node detail panel (for non-credential nodes)
// ---------------------------------------------------------------------------

function NodeDetailPanel({
  node,
  edges,
  allNodes,
  onClose,
  onNodeClick,
}: {
  node: GraphNode | null;
  edges: { id: string; source: string; target: string; label?: string; style: string }[];
  allNodes: GraphNode[];
  onClose: () => void;
  onNodeClick: (id: string) => void;
}) {
  if (!node) return null;
  const Icon = KIND_ICONS[node.kind];

  const connections = edges.map((e) => {
    const otherId = e.source === node.id ? e.target : e.source;
    const otherNode = allNodes.find((n) => n.id === otherId);
    return { edge: e, node: otherNode };
  }).filter((c) => c.node != null);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      className="rounded-xl border border-primary/15 bg-secondary/30 overflow-hidden"
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-primary/10">
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4" style={{ color: node.color }} />
          <span className="text-sm font-medium text-foreground/85">{node.label}</span>
        </div>
        <button type="button" onClick={onClose} className="p-1 hover:bg-secondary/50 rounded transition-colors cursor-pointer">
          <X className="w-3.5 h-3.5 text-muted-foreground/50" />
        </button>
      </div>

      <div className="p-3 space-y-2">
        <div className="text-xs text-muted-foreground/60">
          {connections.length} connection{connections.length !== 1 ? 's' : ''}
        </div>

        <div className="space-y-1 max-h-[250px] overflow-y-auto">
          {connections.map(({ edge, node: connNode }) => {
            if (!connNode) return null;
            const ConnIcon = KIND_ICONS[connNode.kind];
            return (
              <button
                key={edge.id}
                type="button"
                onClick={() => onNodeClick(connNode.id)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-secondary/40 transition-colors text-left cursor-pointer"
              >
                <ConnIcon className="w-3 h-3 flex-shrink-0" style={{ color: connNode.color }} />
                <span className="text-xs text-foreground/80 truncate flex-1">{connNode.label}</span>
                {edge.label && (
                  <span className="text-xs text-muted-foreground/60">{edge.label}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
}
