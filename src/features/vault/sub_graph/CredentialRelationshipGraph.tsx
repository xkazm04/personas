import { useState, useEffect, useMemo, useCallback } from 'react';
import { Network, ArrowRight } from 'lucide-react';
import { EmptyIllustration } from '@/features/shared/components/display/EmptyIllustration';
import { AnimatePresence } from 'framer-motion';
import { motion } from 'framer-motion';
import { useVaultStore } from "@/stores/vaultStore";
import { useAgentStore } from "@/stores/agentStore";
import { usePipelineStore } from "@/stores/pipelineStore";
import { useOverviewStore } from "@/stores/overviewStore";
import { getCredentialDependents } from '@/api/vault/credentials';
import type { CredentialDependent } from '@/lib/bindings/CredentialDependent';
import {
  buildCredentialGraph,
  analyzeBlastRadius,
  simulateRevocation,
  type GraphNodeKind,
} from './credentialGraph';
import { KIND_ICONS, KIND_LABELS } from './graphConstants';
import { NodeChip, HealthDot } from './NodeChip';
import { BlastRadiusPanel } from './BlastRadiusPanel';
import { NodeDetailPanel } from './NodeDetailPanel';

export function CredentialRelationshipGraph() {
  const credentials = useVaultStore((s) => s.credentials);
  const connectorDefinitions = useVaultStore((s) => s.connectorDefinitions);
  const personas = useAgentStore((s) => s.personas);
  const credentialEvents = useVaultStore((s) => s.credentialEvents);
  const fetchCredentialEvents = useVaultStore((s) => s.fetchCredentialEvents);

  // Simulation data sources
  const workflows = usePipelineStore((s) => s.workflows);
  const fetchWorkflows = usePipelineStore((s) => s.fetchWorkflows);
  const healthSignals = useOverviewStore((s) => s.healthSignals);

  const [dependentsMap, setDependentsMap] = useState<Map<string, CredentialDependent[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [filterKind, setFilterKind] = useState<GraphNodeKind | 'all'>('all');
  const [simulationMode, setSimulationMode] = useState(false);

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

  // Ensure workflows are loaded for simulation
  useEffect(() => {
    fetchWorkflows();
  }, [fetchWorkflows]);

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

  // Simulation result — computed when simulation mode is active and a credential is selected
  const selectedSimulation = useMemo(() => {
    if (!simulationMode || !selectedNodeId) return null;
    const node = graph.nodes.find((n) => n.id === selectedNodeId);
    if (!node || node.kind !== 'credential') return null;
    return simulateRevocation(selectedNodeId, graph, workflows, healthSignals, credentials);
  }, [simulationMode, selectedNodeId, graph, workflows, healthSignals, credentials]);

  const stats = useMemo(() => {
    const counts: Record<GraphNodeKind, number> = { credential: 0, agent: 0, event: 0 };
    for (const n of graph.nodes) counts[n.kind]++;
    return counts;
  }, [graph.nodes]);

  const handleNodeClick = useCallback((nodeId: string) => {
    setSelectedNodeId((prev) => prev === nodeId ? null : nodeId);
  }, []);

  const handleToggleSimulation = useCallback(() => {
    setSimulationMode((prev) => !prev);
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
      <EmptyIllustration
        icon={Network}
        heading="No credentials to graph"
        description="Add credentials to visualize their relationships and dependencies."
        className="py-10"
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary stats */}
      <div className="grid grid-cols-3 3xl:grid-cols-4 4xl:grid-cols-6 gap-2">
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
      <div className="grid grid-cols-1 lg:grid-cols-3 3xl:grid-cols-4 4xl:grid-cols-5 gap-3">
        {/* Left: node lists */}
        <div className="lg:col-span-2 3xl:col-span-3 4xl:col-span-4 space-y-2">
          {(filterKind === 'all' || filterKind === 'credential') && (
            <div className="rounded-xl border border-primary/10 bg-secondary/20 p-3">
              <div className="text-xs font-medium text-muted-foreground/60 mb-2">
                Credentials ({graph.nodes.filter((n) => n.kind === 'credential').length})
              </div>
              <div className="space-y-1">
                {graph.nodes
                  .filter((n) => n.kind === 'credential')
                  .sort((a, b) => a.label.localeCompare(b.label))
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

          {filterKind !== 'all' && filterKind !== 'credential' && (
            <div className="rounded-xl border border-primary/10 bg-secondary/20 p-3">
              <div className="text-xs font-medium text-muted-foreground/60 mb-2">
                {KIND_LABELS[filterKind]} ({filteredNodes.length})
              </div>
              <div className="space-y-1">
                {[...filteredNodes].sort((a, b) => a.label.localeCompare(b.label)).map((node) => (
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

        {/* Right: detail panel */}
        <div className="space-y-2">
          <AnimatePresence mode="wait">
            {selectedBlast ? (
              <BlastRadiusPanel
                key={selectedBlast.credentialId}
                blast={selectedBlast}
                onClose={() => setSelectedNodeId(null)}
                simulation={selectedSimulation}
                simulationMode={simulationMode}
                onToggleSimulation={handleToggleSimulation}
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
                className="rounded-xl border border-primary/10 bg-secondary/20 p-6"
              >
                <EmptyIllustration
                  icon={Network}
                  heading="No credential selected"
                  description="Select a credential to see its blast radius and dependencies."
                />
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
