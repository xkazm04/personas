import { ArrowRight } from 'lucide-react';
import { NodeChip, HealthDot } from './NodeChip';
import type { GraphNode, GraphEdge, GraphNodeKind } from './credentialGraph';
import { getKindLabels } from './graphConstants';
import { useTranslation } from '@/i18n/useTranslation';
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
  const { t, tx } = useTranslation();
  const dep = t.vault.dependencies;
  const kindLabels = getKindLabels(t);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 3xl:grid-cols-4 4xl:grid-cols-5 gap-3">
      {/* Left: node lists */}
      <div className="lg:col-span-2 3xl:col-span-3 4xl:col-span-4 space-y-2">
        {(filterKind === 'all' || filterKind === 'credential') && (
          <div className="rounded-modal border border-primary/10 bg-secondary/20 p-3">
            <div className="typo-caption font-medium text-foreground mb-2">
              {tx(dep.credentials_label, { count: nodes.filter((n) => n.kind === 'credential').length })}
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
          <div className="rounded-modal border border-primary/10 bg-secondary/20 p-3">
            <div className="typo-caption font-medium text-foreground mb-2">
              {kindLabels[filterKind]} ({filteredNodes.length})
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
        <div className="rounded-modal border border-primary/10 bg-secondary/20 p-3">
          <div className="typo-caption font-medium text-foreground mb-2">
            {tx(dep.relationships, { count: filteredEdges.length })}
          </div>
          <div className="space-y-1 max-h-[200px] overflow-y-auto">
            {filteredEdges.slice(0, 30).map((edge) => {
              const srcNode = nodes.find((n) => n.id === edge.source);
              const tgtNode = nodes.find((n) => n.id === edge.target);
              if (!srcNode || !tgtNode) return null;
              return (
                <div key={edge.id} className="flex items-center gap-1.5 typo-caption text-foreground">
                  <span className="truncate max-w-[80px]" title={srcNode.label}>{srcNode.label}</span>
                  <ArrowRight className="w-3 h-3 flex-shrink-0 text-foreground" />
                  <span className="text-foreground flex-shrink-0">{edge.label}</span>
                  <ArrowRight className="w-3 h-3 flex-shrink-0 text-foreground" />
                  <span className="truncate max-w-[80px]" title={tgtNode.label}>{tgtNode.label}</span>
                </div>
              );
            })}
            {filteredEdges.length > 30 && (
              <div className="typo-caption text-foreground pt-1">
                {tx(dep.more_relationships, { count: filteredEdges.length - 30 })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
