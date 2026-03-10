import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Workflow } from 'lucide-react';
import type { UseCaseFlow, FlowNode } from '@/lib/types/frontendTypes';
import FlowDiagram from './FlowDiagram';
import NodePopover from './NodePopover';
import PopoverPositioner from './PopoverPositioner';

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
