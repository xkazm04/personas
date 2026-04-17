import { useState, useEffect, useMemo, useCallback } from 'react';
import { Network } from 'lucide-react';
import { EmptyIllustration } from '@/features/shared/components/display/EmptyIllustration';
import { useTranslation } from '@/i18n/useTranslation';
import { useVaultStore } from "@/stores/vaultStore";
import { useAgentStore } from "@/stores/agentStore";
import { useOverviewStore } from "@/stores/overviewStore";
import { getCredentialDependents } from '@/api/vault/credentials';
import type { CredentialDependent } from '@/lib/bindings/CredentialDependent';
import {
  buildCredentialGraph,
  analyzeBlastRadius,
  simulateRevocation,
  type GraphNodeKind,
} from './credentialGraph';
import { BlastRadiusPanel } from './BlastRadiusPanel';
import { NodeDetailPanel } from './NodeDetailPanel';
import { GraphControls } from './GraphControls';
import { GraphCanvas } from './GraphCanvas';

export function CredentialRelationshipGraph() {
  const credentials = useVaultStore((s) => s.credentials);
  const connectorDefinitions = useVaultStore((s) => s.connectorDefinitions);
  const personas = useAgentStore((s) => s.personas);
  const credentialEvents = useVaultStore((s) => s.credentialEvents);
  const fetchCredentialEvents = useVaultStore((s) => s.fetchCredentialEvents);

  const { t } = useTranslation();
  const dep = t.vault.dependencies;
  const healthSignals = useOverviewStore((s) => s.healthSignals);

  const [dependentsMap, setDependentsMap] = useState<Map<string, CredentialDependent[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [filterKind, setFilterKind] = useState<GraphNodeKind | 'all'>('all');
  const [simulationMode, setSimulationMode] = useState(false);

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
      if (!cancelled) { setDependentsMap(map); setLoading(false); }
    };
    if (credentials.length > 0) { load(); } else { setLoading(false); }
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

  const selectedSimulation = useMemo(() => {
    if (!simulationMode || !selectedNodeId) return null;
    const node = graph.nodes.find((n) => n.id === selectedNodeId);
    if (!node || node.kind !== 'credential') return null;
    return simulateRevocation(selectedNodeId, graph, [], healthSignals, credentials);
  }, [simulationMode, selectedNodeId, graph, healthSignals, credentials]);

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
        heading={dep.no_credentials_graph}
        description={dep.no_credentials_graph_hint}
        className="py-10"
      />
    );
  }

  const detailPanel = selectedBlast ? (
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
    <div key="empty" className="animate-fade-slide-in rounded-modal border border-primary/10 bg-secondary/20 p-6">
      <EmptyIllustration
        icon={Network}
        heading={dep.no_credential_selected}
        description={dep.no_credential_selected_hint}
      />
    </div>
  );

  return (
    <div className="space-y-4">
      <GraphControls stats={stats} filterKind={filterKind} onFilterChange={setFilterKind} />
      <GraphCanvas
        nodes={graph.nodes}
        edges={graph.edges}
        filteredNodes={filteredNodes}
        filteredEdges={filteredEdges}
        filterKind={filterKind}
        selectedNodeId={selectedNodeId}
        credentials={credentials}
        onNodeClick={handleNodeClick}
        detailPanel={detailPanel}
      />
    </div>
  );
}
