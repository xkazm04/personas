import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Network } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { GraphNode, GraphEdge, GraphNodeKind } from './credentialGraph';
import { getKindLabels, KIND_ICONS } from './graphConstants';
import { computeGraphLayout, clusterCenters, KIND_ORDER, type NodePos } from './graphLayout';
import type { CredentialMetadata } from '@/lib/types/types';

interface GraphCanvasProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  filteredNodes: GraphNode[];
  filteredEdges: GraphEdge[];
  filterKind: GraphNodeKind | 'all';
  selectedNodeId: string | null;
  credentials: CredentialMetadata[];
  onNodeClick: (nodeId: string) => void;
  detailPanel: React.ReactNode;
}

// Cluster-label tints (fallbacks; individual nodes carry their own color).
const KIND_TINT: Record<GraphNodeKind, string> = {
  credential: '#8b5cf6',
  agent: '#3b82f6',
  event: '#f59e0b',
};

const HEALTH_HEX = { ok: '#34d399', bad: '#f87171', unknown: '#71717a' };

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export function GraphCanvas({ nodes, edges, filterKind, selectedNodeId, onNodeClick, detailPanel }: GraphCanvasProps) {
  const { t, tx } = useTranslation();
  const dep = t.vault.dependencies;
  const kindLabels = getKindLabels(t);

  const containerRef = useRef<HTMLDivElement>(null);
  const [dim, setDim] = useState({ width: 900, height: 600 });
  const [hovered, setHovered] = useState<string | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setDim({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const layout = useMemo(() => computeGraphLayout(nodes, edges, dim.width, dim.height), [nodes, edges, dim]);
  const nodeMap = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const centers = useMemo(() => clusterCenters(dim.width, dim.height), [dim]);

  const adjacency = useMemo(() => {
    const adj = new Map<string, Set<string>>();
    const link = (a: string, b: string) => {
      let set = adj.get(a);
      if (!set) { set = new Set(); adj.set(a, set); }
      set.add(b);
    };
    for (const e of edges) { link(e.source, e.target); link(e.target, e.source); }
    return adj;
  }, [edges]);

  const neighborIds = useMemo(() => {
    if (!hovered) return null;
    const set = new Set<string>([hovered]);
    adjacency.get(hovered)?.forEach((id) => set.add(id));
    return set;
  }, [hovered, adjacency]);

  const counts = useMemo(() => {
    const c: Record<GraphNodeKind, number> = { credential: 0, agent: 0, event: 0 };
    for (const n of nodes) c[n.kind]++;
    return c;
  }, [nodes]);

  const nodeDimmed = (node: GraphNode): boolean => {
    if (neighborIds) return !neighborIds.has(node.id);
    if (filterKind !== 'all') return node.kind !== filterKind;
    return false;
  };

  return (
    <div
      ref={containerRef}
      className="relative w-full h-[600px] rounded-modal border border-primary/10 bg-secondary/5 shadow-elevation-2 overflow-hidden"
      onMouseLeave={() => setHovered(null)}
    >
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse 60% 50% at 50% 50%, color-mix(in srgb, var(--primary) 6%, transparent), transparent 80%)' }}
      />

      {/* Cluster labels */}
      {KIND_ORDER.map((kind) => counts[kind] > 0 && (
        <ClusterLabel key={kind} label={kindLabels[kind]} count={counts[kind]} center={centers[kind]} tint={KIND_TINT[kind]} />
      ))}

      <svg width={dim.width} height={dim.height} className="absolute inset-0">
        {/* Edges */}
        {edges.map((edge) => {
          const from = layout.get(edge.source);
          const to = layout.get(edge.target);
          if (!from || !to) return null;
          const color = nodeMap.get(edge.source)?.color ?? '#64748b';
          const hl = hovered != null && (edge.source === hovered || edge.target === hovered);
          const filterDim = filterKind !== 'all'
            && nodeMap.get(edge.source)?.kind !== filterKind
            && nodeMap.get(edge.target)?.kind !== filterKind;
          const opacity = hovered ? (hl ? 0.5 : 0.04) : (filterDim ? 0.04 : 0.16);
          return (
            <motion.line
              key={edge.id}
              x1={from.x} y1={from.y} x2={to.x} y2={to.y}
              stroke={color}
              strokeWidth={hl ? 1.6 : 0.6}
              opacity={opacity}
              strokeDasharray={hl ? 'none' : '4 4'}
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.6 }}
            />
          );
        })}

        {/* Nodes */}
        {nodes.map((node) => {
          const pos = layout.get(node.id);
          if (!pos) return null;
          return (
            <GraphNodeCircle
              key={node.id}
              node={node}
              pos={pos}
              selected={selectedNodeId === node.id}
              highlighted={hovered === node.id || (neighborIds?.has(node.id) ?? false)}
              dimmed={nodeDimmed(node)}
              onHover={setHovered}
              onClick={() => onNodeClick(node.id)}
            />
          );
        })}
      </svg>

      {/* Legends */}
      <SizeLegend label={dep.graph_connections} />
      <KindLegend kindLabels={kindLabels} counts={counts} relationshipsLabel={tx(dep.relationships, { count: edges.length })} healthLabels={{ ok: dep.healthy, bad: dep.unhealthy, unknown: dep.not_tested }} />

      {/* Floating detail panel (parent-owned BlastRadius / NodeDetail) */}
      <AnimatePresence>
        {selectedNodeId && (
          <motion.div
            key={selectedNodeId}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="absolute right-3 top-3 z-50 w-80 max-h-[calc(100%-1.5rem)] overflow-y-auto"
          >
            {detailPanel}
          </motion.div>
        )}
      </AnimatePresence>

      {nodes.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="flex flex-col items-center gap-3">
            <Network className="w-8 h-8 text-foreground" />
            <p className="typo-body text-foreground">{dep.graph_empty}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function GraphNodeCircle({ node, pos, selected, highlighted, dimmed, onHover, onClick }: {
  node: GraphNode; pos: NodePos; selected: boolean; highlighted: boolean; dimmed: boolean;
  onHover: (id: string) => void; onClick: () => void;
}) {
  const color = node.color;
  const health = node.kind === 'credential' ? node.meta.healthOk : undefined;
  const healthStroke = health === true ? HEALTH_HEX.ok : health === false ? HEALTH_HEX.bad : HEALTH_HEX.unknown;

  return (
    <motion.g
      initial={{ opacity: 0, scale: 0 }}
      animate={{ opacity: dimmed ? 0.2 : 1, scale: 1 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      style={{ cursor: 'pointer' }}
      onMouseEnter={() => onHover(node.id)}
      onClick={onClick}
    >
      {(selected || highlighted) && (
        <circle cx={pos.x} cy={pos.y} r={pos.r + 5} fill="none" stroke={color} strokeWidth={1.5} opacity={0.5} />
      )}
      {health !== undefined && (
        <circle cx={pos.x} cy={pos.y} r={pos.r + 2} fill="none" stroke={healthStroke} strokeWidth={1.5} opacity={0.7} />
      )}
      <circle cx={pos.x} cy={pos.y} r={pos.r} fill={`${color}25`} stroke={selected ? color : `${color}60`} strokeWidth={selected ? 2 : 1} />
      <circle cx={pos.x} cy={pos.y} r={Math.max(2, pos.r * 0.22)} fill={color} />
      <text
        x={pos.x}
        y={pos.y + pos.r + 11}
        textAnchor="middle"
        className="pointer-events-none select-none"
        style={{ fontSize: 9, fill: 'var(--foreground)', opacity: dimmed ? 0 : (highlighted || selected ? 0.95 : 0.5) }}
      >
        {truncate(node.label, 16)}
      </text>
    </motion.g>
  );
}

function ClusterLabel({ label, count, center, tint }: { label: string; count: number; center: { x: number; y: number }; tint: string }) {
  return (
    <div className="absolute pointer-events-none -translate-x-1/2 -translate-y-1/2" style={{ left: center.x, top: center.y }}>
      <span className="typo-label opacity-40" style={{ color: tint }}>{label} · {count}</span>
    </div>
  );
}

function SizeLegend({ label }: { label: string }) {
  return (
    <div className="absolute left-3 top-3 flex items-center gap-2 bg-background/80 backdrop-blur-sm rounded-card border border-primary/15 px-3 py-2">
      <span className="typo-label text-foreground">{label}</span>
      <svg width={10} height={10}><circle cx={5} cy={5} r={3} fill="currentColor" className="text-foreground" /></svg>
      <svg width={18} height={18}><circle cx={9} cy={9} r={7} fill="currentColor" className="text-foreground" /></svg>
    </div>
  );
}

function KindLegend({ kindLabels, counts, relationshipsLabel, healthLabels }: {
  kindLabels: Record<GraphNodeKind, string>;
  counts: Record<GraphNodeKind, number>;
  relationshipsLabel: string;
  healthLabels: { ok: string; bad: string; unknown: string };
}) {
  return (
    <div className="absolute left-3 bottom-3 flex flex-col gap-2 bg-background/80 backdrop-blur-sm rounded-card border border-primary/15 px-3 py-2">
      <div className="flex items-center gap-3">
        {KIND_ORDER.map((kind) => {
          const Icon = KIND_ICONS[kind];
          return (
            <div key={kind} className="flex items-center gap-1.5">
              <Icon className="w-3 h-3" style={{ color: KIND_TINT[kind] }} />
              <span className="typo-caption text-foreground">{kindLabels[kind]}</span>
              <span className="typo-data tabular-nums text-foreground/90">{counts[kind]}</span>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-3 pt-2 border-t border-primary/10">
        <span className="typo-caption text-foreground">{relationshipsLabel}</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: HEALTH_HEX.ok }} /><span className="typo-caption text-foreground">{healthLabels.ok}</span></span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: HEALTH_HEX.bad }} /><span className="typo-caption text-foreground">{healthLabels.bad}</span></span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: HEALTH_HEX.unknown }} /><span className="typo-caption text-foreground">{healthLabels.unknown}</span></span>
      </div>
    </div>
  );
}
