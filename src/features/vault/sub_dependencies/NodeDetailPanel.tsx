import { X } from 'lucide-react';
import type { GraphNode } from './credentialGraph';
import { KIND_ICONS } from './graphConstants';

interface NodeDetailPanelProps {
  node: GraphNode | null;
  edges: { id: string; source: string; target: string; label?: string; style: string }[];
  allNodes: GraphNode[];
  onClose: () => void;
  onNodeClick: (id: string) => void;
}

export function NodeDetailPanel({ node, edges, allNodes, onClose, onNodeClick }: NodeDetailPanelProps) {
  if (!node) return null;
  const Icon = KIND_ICONS[node.kind];

  const connections = edges.map((e) => {
    const otherId = e.source === node.id ? e.target : e.source;
    const otherNode = allNodes.find((n) => n.id === otherId);
    return { edge: e, node: otherNode };
  }).filter((c) => c.node != null);

  return (
    <div
      className="animate-fade-slide-in rounded-xl border border-primary/15 bg-secondary/30 overflow-hidden"
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
    </div>
  );
}
