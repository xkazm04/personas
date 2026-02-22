import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Play,
  CheckCircle2,
  Wrench,
  GitBranch,
  Zap,
  ShieldAlert,
  Plug,
  Workflow,
} from 'lucide-react';
import type { UseCaseFlow, FlowNode } from '@/lib/types/frontendTypes';

// ============================================================================
// Constants
// ============================================================================

interface NodeTypeMeta {
  label: string;
  color: string;
  Icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  cardStyle: string;
  textColor: string;
  iconColor: string;
}

const NODE_TYPE_META: Record<string, NodeTypeMeta> = {
  start: {
    label: 'Start', color: '#10b981', Icon: Play,
    cardStyle: 'rounded-full bg-emerald-500/10 border-emerald-500/30 shadow-[0_0_12px_rgba(16,185,129,0.15)]',
    textColor: 'text-emerald-300', iconColor: 'text-emerald-400',
  },
  end: {
    label: 'End', color: '#3b82f6', Icon: CheckCircle2,
    cardStyle: 'rounded-full bg-blue-500/10 border-blue-500/30 shadow-[0_0_12px_rgba(59,130,246,0.15)]',
    textColor: 'text-blue-300', iconColor: 'text-blue-400',
  },
  action: {
    label: 'Action', color: '#64748b', Icon: Wrench,
    cardStyle: 'bg-secondary/60 border-primary/20',
    textColor: 'text-foreground/90', iconColor: 'text-muted-foreground',
  },
  decision: {
    label: 'Decision', color: '#f59e0b', Icon: GitBranch,
    cardStyle: 'bg-amber-500/10 border-2 border-amber-500/30 shadow-[0_0_12px_rgba(245,158,11,0.15)]',
    textColor: 'text-amber-300', iconColor: 'text-amber-400',
  },
  connector: {
    label: 'Connector', color: '#8b5cf6', Icon: Plug,
    cardStyle: 'bg-secondary/60 border-2 border-violet-500/30 shadow-[0_0_16px_rgba(139,92,246,0.1)]',
    textColor: 'text-foreground/90', iconColor: 'text-violet-400',
  },
  event: {
    label: 'Event', color: '#8b5cf6', Icon: Zap,
    cardStyle: 'bg-violet-500/10 border-violet-500/30 shadow-[0_0_12px_rgba(139,92,246,0.15)]',
    textColor: 'text-violet-300', iconColor: 'text-violet-400',
  },
  error: {
    label: 'Error', color: '#ef4444', Icon: ShieldAlert,
    cardStyle: 'bg-red-500/10 border-dashed border-red-500/30 shadow-[0_0_12px_rgba(239,68,68,0.15)]',
    textColor: 'text-red-300', iconColor: 'text-red-400',
  },
};

// ============================================================================
// Node Detail Popover
// ============================================================================

interface NodePopoverProps {
  node: FlowNode;
  onClose: () => void;
}

function tryParseJson(str: string): string {
  try {
    const parsed = JSON.parse(str);
    return typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2);
  } catch {
    return str;
  }
}

const DEFAULT_NODE_META: NodeTypeMeta = {
  label: 'Action', color: '#64748b', Icon: Wrench,
  cardStyle: 'bg-secondary/60 border-primary/20',
  textColor: 'text-foreground/90', iconColor: 'text-muted-foreground',
};

function NodePopover({ node, onClose }: NodePopoverProps) {
  const typeMeta = NODE_TYPE_META[node.type] ?? DEFAULT_NODE_META;
  const TypeIcon = typeMeta.Icon;

  const requestData = node.request_data ? tryParseJson(node.request_data) : null;
  const responseData = node.response_data ? tryParseJson(node.response_data) : null;

  return (
    <div
      className="bg-background/95 border border-primary/20 rounded-xl shadow-2xl backdrop-blur-sm p-4 space-y-3 max-w-sm"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center gap-2">
        <div
          className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0"
          style={{ backgroundColor: `${typeMeta.color}20`, border: `1px solid ${typeMeta.color}40` }}
        >
          <TypeIcon className="w-3.5 h-3.5" style={{ color: typeMeta.color }} />
        </div>
        <span className="text-sm font-mono uppercase tracking-wider text-muted-foreground/90">{typeMeta.label}</span>
        <button onClick={onClose} className="ml-auto w-5 h-5 rounded flex items-center justify-center hover:bg-secondary/60 transition-colors">
          <X className="w-3 h-3 text-muted-foreground/80" />
        </button>
      </div>

      <div className="text-sm font-medium text-foreground/90">{node.label}</div>

      {node.detail && (
        <p className="text-sm text-muted-foreground/80 leading-relaxed">{node.detail}</p>
      )}

      {node.error_message && (
        <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/15">
          <div className="text-sm font-mono uppercase tracking-wider text-red-400/60 mb-1">Error</div>
          <p className="text-sm text-red-400/90 leading-relaxed">{node.error_message}</p>
        </div>
      )}

      {requestData && (
        <div>
          <div className="text-sm font-mono uppercase tracking-wider text-blue-400/50 mb-1">Request</div>
          <pre className="text-sm text-blue-300/70 bg-blue-500/5 border border-blue-500/10 rounded-lg px-3 py-2 max-h-28 overflow-auto whitespace-pre-wrap break-words font-mono leading-relaxed">
            {typeof requestData === 'string' ? requestData : JSON.stringify(requestData, null, 2)}
          </pre>
        </div>
      )}

      {responseData && (
        <div>
          <div className="text-sm font-mono uppercase tracking-wider text-emerald-400/50 mb-1">Response</div>
          <pre className="text-sm text-emerald-300/70 bg-emerald-500/5 border border-emerald-500/10 rounded-lg px-3 py-2 max-h-28 overflow-auto whitespace-pre-wrap break-words font-mono leading-relaxed">
            {typeof responseData === 'string' ? responseData : JSON.stringify(responseData, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Flow Node Rendering (CSS-based, no reactflow)
// ============================================================================

function FlowNodeCard({
  node,
  onClick,
}: {
  node: FlowNode;
  onClick: (node: FlowNode, e: React.MouseEvent) => void;
}) {
  const meta = NODE_TYPE_META[node.type] ?? DEFAULT_NODE_META;
  const Icon = meta.Icon;

  const baseClasses = 'cursor-pointer px-4 py-2.5 rounded-xl border min-w-[140px] max-w-[220px] text-center transition-all hover:scale-105';

  const truncatedLabel = node.label.length > 30 ? node.label.slice(0, 28) + '\u2026' : node.label;

  return (
    <div
      className={`${baseClasses} ${meta.cardStyle}`}
      onClick={(e) => onClick(node, e)}
    >
      <div className="flex items-center justify-center gap-2">
        <Icon className={`w-4 h-4 shrink-0 ${meta.iconColor}`} />
        <span className={`text-sm font-medium ${meta.textColor}`}>{truncatedLabel}</span>
      </div>
    </div>
  );
}

// ============================================================================
// Simple vertical flow layout
// ============================================================================

function FlowDiagram({
  flow,
  onNodeClick,
}: {
  flow: UseCaseFlow;
  onNodeClick: (node: FlowNode, e: React.MouseEvent) => void;
}) {
  // Build adjacency from edges
  const adjacency = useMemo(() => {
    const adj = new Map<string, { target: string; label?: string }[]>();
    for (const edge of flow.edges) {
      const list = adj.get(edge.source) || [];
      list.push({ target: edge.target, label: edge.label });
      adj.set(edge.source, list);
    }
    return adj;
  }, [flow.edges]);

  // BFS layering
  const layers = useMemo(() => {
    const inDegree = new Map<string, number>();
    for (const node of flow.nodes) inDegree.set(node.id, 0);
    for (const edge of flow.edges) {
      inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1);
    }

    const visited = new Set<string>();
    const result: string[][] = [];
    let queue = flow.nodes
      .filter(n => n.type === 'start' || (inDegree.get(n.id) || 0) === 0)
      .map(n => n.id);

    if (queue.length === 0 && flow.nodes.length > 0) {
      const first = flow.nodes[0];
      if (first) queue = [first.id];
    }

    while (queue.length > 0) {
      const level: string[] = [];
      const next: string[] = [];
      for (const id of queue) {
        if (visited.has(id)) continue;
        visited.add(id);
        level.push(id);
        for (const { target } of adjacency.get(id) || []) {
          if (!visited.has(target)) next.push(target);
        }
      }
      if (level.length > 0) result.push(level);
      queue = next;
    }

    // Add orphaned nodes
    for (const node of flow.nodes) {
      if (!visited.has(node.id)) {
        if (result.length === 0) result.push([]);
        const lastLevel = result[result.length - 1];
        if (lastLevel) lastLevel.push(node.id);
      }
    }

    return result;
  }, [flow.nodes, flow.edges, adjacency]);

  const nodeMap = useMemo(() => new Map(flow.nodes.map(n => [n.id, n])), [flow.nodes]);

  return (
    <div className="flex flex-col items-center gap-1 py-6 px-4 overflow-auto">
      {layers.map((layer, layerIdx) => (
        <div key={layerIdx}>
          {/* Connector arrow from previous layer */}
          {layerIdx > 0 && (
            <div className="flex justify-center py-1">
              <div className="w-px h-6 bg-primary/20"></div>
            </div>
          )}
          {/* Nodes in this layer */}
          <div className="flex items-center justify-center gap-3 flex-wrap">
            {layer.map(nodeId => {
              const node = nodeMap.get(nodeId);
              if (!node) return null;
              return (
                <FlowNodeCard key={node.id} node={node} onClick={onNodeClick} />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// Popover Positioner (viewport-clamped near click)
// ============================================================================

const POPOVER_WIDTH = 320;
const POPOVER_OFFSET = 16;

function PopoverPositioner({
  canvasRef,
  pos,
  children,
}: {
  canvasRef: React.RefObject<HTMLDivElement | null>;
  pos: { x: number; y: number };
  children: React.ReactNode;
}) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({ opacity: 0, position: 'absolute' });
  const [pointerSide, setPointerSide] = useState<'left' | 'right'>('left');

  useEffect(() => {
    const canvas = canvasRef.current;
    const popover = popoverRef.current;
    if (!canvas || !popover) return;

    const canvasW = canvas.scrollWidth;
    const popoverH = popover.offsetHeight;

    // Try placing to the right of the click point
    let left = pos.x + POPOVER_OFFSET;
    let side: 'left' | 'right' = 'left';

    // If it overflows right, place to the left
    if (left + POPOVER_WIDTH > canvasW - 8) {
      left = pos.x - POPOVER_WIDTH - POPOVER_OFFSET;
      side = 'right';
    }
    // Clamp left
    left = Math.max(8, left);

    // Vertical: center on click point, clamp within canvas
    let top = pos.y - popoverH / 2;
    top = Math.max(8, top);

    setStyle({ position: 'absolute', left, top, width: POPOVER_WIDTH, zIndex: 10 });
    setPointerSide(side);
  }, [canvasRef, pos]);

  return (
    <div ref={popoverRef} style={style}>
      {children}
      {/* Triangle pointer */}
      <div
        className="absolute top-1/2 -translate-y-1/2"
        style={pointerSide === 'left'
          ? { left: -6 }
          : { right: -6 }
        }
      >
        <div
          className="w-3 h-3 bg-background/95 border border-primary/20 rotate-45"
          style={pointerSide === 'left'
            ? { borderRight: 'none', borderTop: 'none' }
            : { borderLeft: 'none', borderBottom: 'none' }
          }
        />
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

interface ActivityDiagramModalProps {
  isOpen: boolean;
  onClose: () => void;
  templateName: string;
  flows: UseCaseFlow[];
  titleOverride?: string;
  subtitleOverride?: string;
}

export default function ActivityDiagramModal({ isOpen, onClose, templateName, flows, titleOverride, subtitleOverride }: ActivityDiagramModalProps) {
  const [activeFlowIndex, setActiveFlowIndex] = useState(0);
  const [inspectedNode, setInspectedNode] = useState<FlowNode | null>(null);
  const [popoverPos, setPopoverPos] = useState<{ x: number; y: number } | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const activeFlow = flows[activeFlowIndex] || null;

  // Auto-focus close button on mount
  useEffect(() => {
    if (isOpen) closeButtonRef.current?.focus();
  }, [isOpen]);

  // Escape key handler
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  // Focus trap: keep Tab within the modal
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'Tab' || !dialogRef.current) return;

    const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    if (focusable.length === 0) return;

    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;

    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }, []);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center"
      >
        {/* Backdrop */}
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

        {/* Modal */}
        <motion.div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={titleOverride || templateName}
          onKeyDown={handleKeyDown}
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          className="relative w-[90vw] h-[85vh] max-w-7xl bg-background/95 border border-primary/20 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-primary/10 bg-secondary/30">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
                <Workflow className="w-5 h-5 text-violet-400" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-foreground/90">{titleOverride || templateName}</h2>
                <p className="text-sm text-muted-foreground/90">
                  {subtitleOverride || `${flows.length} use case flow${flows.length !== 1 ? 's' : ''}`}
                </p>
              </div>
            </div>
            <button ref={closeButtonRef} onClick={onClose} className="w-8 h-8 rounded-lg bg-secondary/50 hover:bg-secondary flex items-center justify-center transition-colors" aria-label="Close dialog">
              <X className="w-4 h-4 text-muted-foreground/80" />
            </button>
          </div>

          {/* Use Case Tabs */}
          {flows.length > 1 && (
            <div className="flex items-center gap-2 px-6 py-3 border-b border-primary/10 bg-secondary/20 overflow-x-auto">
              {flows.map((flow, index) => (
                <button
                  key={flow.id}
                  onClick={() => {
                    setActiveFlowIndex(index);
                    setInspectedNode(null);
                    setPopoverPos(null);
                  }}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all whitespace-nowrap ${
                    index === activeFlowIndex
                      ? 'bg-violet-500/15 border border-violet-500/30 text-violet-300 shadow-[0_0_12px_rgba(139,92,246,0.1)]'
                      : 'bg-secondary/40 border border-transparent text-muted-foreground/80 hover:bg-secondary/60 hover:text-muted-foreground'
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full ${index === activeFlowIndex ? 'bg-violet-400' : 'bg-muted-foreground/30'}`} />
                  {flow.name}
                </button>
              ))}
            </div>
          )}

          {/* Diagram Canvas */}
          <div ref={canvasRef} className="flex-1 relative overflow-auto" onClick={() => setInspectedNode(null)}>
            {activeFlow ? (
              <FlowDiagram
                flow={activeFlow}
                onNodeClick={(node, e) => {
                  e.stopPropagation();
                  if (inspectedNode?.id === node.id) {
                    setInspectedNode(null);
                    setPopoverPos(null);
                    return;
                  }
                  // Calculate position relative to the canvas container
                  const canvas = canvasRef.current;
                  if (canvas) {
                    const rect = canvas.getBoundingClientRect();
                    setPopoverPos({
                      x: e.clientX - rect.left + canvas.scrollLeft,
                      y: e.clientY - rect.top + canvas.scrollTop,
                    });
                  }
                  setInspectedNode(node);
                }}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground/80">
                No flow data available
              </div>
            )}

            {/* Node Detail Popover */}
            {inspectedNode && popoverPos && (
              <PopoverPositioner canvasRef={canvasRef} pos={popoverPos}>
                <NodePopover
                  node={inspectedNode}
                  onClose={() => { setInspectedNode(null); setPopoverPos(null); }}
                />
              </PopoverPositioner>
            )}
          </div>

          {/* Footer -- Flow Description */}
          {activeFlow && (
            <div className="px-6 py-3 border-t border-primary/10 bg-secondary/20">
              <p className="text-sm text-muted-foreground/90">{activeFlow.description}</p>
              <div className="flex items-center gap-4 mt-1.5 text-sm text-muted-foreground/80">
                <span>{activeFlow.nodes.length} nodes</span>
                <span>{activeFlow.edges.length} edges</span>
                <span>{activeFlow.nodes.filter(n => n.type === 'connector').length} connector(s)</span>
                <span>{activeFlow.nodes.filter(n => n.type === 'decision').length} decision(s)</span>
              </div>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
