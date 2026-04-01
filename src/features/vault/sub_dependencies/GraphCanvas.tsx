import { ArrowRight } from 'lucide-react';
import { NodeChip, HealthDot } from './NodeChip';
import type { GraphNode, GraphEdge, GraphNodeKind } from './credentialGraph';
import { KIND_LABELS } from './graphConstants';
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

export function GraphCanvas({
  nodes,
  filteredNodes,
  filteredEdges,
  filterKind,
  selectedNodeId,
  credentials,
  onNodeClick,
  detailPanel,
}: GraphCanvasProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 3xl:grid-cols-4 4xl:grid-cols-5 gap-3">
      {/* Left: node lists */}
      <div className="lg:col-span-2 3xl:col-span-3 4xl:col-span-4 space-y-2">
        {(filterKind === 'all' || filterKind === 'credential') && (
          <div className="rounded-xl border border-primary/10 bg-secondary/20 p-3">
            <div className="text-xs font-medium text-muted-foreground/60 mb-2">
              Credentials ({nodes.filter((n) => n.kind === 'credential').length})
            </div>
            <div className="space-y-1">
              {nodes
                .filter((n) => n.kind === 'credential')
                .sort((a, b) => a.label.localeCompare(b.label))
                .map((node) => (
                  <NodeChip
                    key={node.id}
                    node={node}
                    isSelected={selectedNodeId === node.id}
                    onClick={() => onNodeClick(node.id)}
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
                  onClick={() => onNodeClick(node.id)}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Right: detail panel */}
      <div className="space-y-2">
        {detailPanel}

        {/* Edge summary */}
        <div className="rounded-xl border border-primary/10 bg-secondary/20 p-3">
          <div className="text-xs font-medium text-muted-foreground/60 mb-2">
            Relationships ({filteredEdges.length})
          </div>
          <div className="space-y-1 max-h-[200px] overflow-y-auto">
            {filteredEdges.slice(0, 30).map((edge) => {
              const srcNode = nodes.find((n) => n.id === edge.source);
              const tgtNode = nodes.find((n) => n.id === edge.target);
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
  );
}
