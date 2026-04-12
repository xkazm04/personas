import { useState, useRef } from 'react';
import { X, Workflow } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { BaseModal } from '@/lib/ui/BaseModal';
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
  const { t } = useTranslation();
  const [activeFlowIndex, setActiveFlowIndex] = useState(0);
  const [inspectedNode, setInspectedNode] = useState<FlowNode | null>(null);
  const [popoverPos, setPopoverPos] = useState<{ x: number; y: number } | null>(null);

  const canvasRef = useRef<HTMLDivElement>(null);

  const activeFlow = flows[activeFlowIndex] || null;

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      titleId="activity-diagram-title"
      panelClassName="bg-background/95 border border-primary/20 rounded-2xl shadow-elevation-4 overflow-hidden flex flex-col w-[90vw] h-[85vh]"
      maxWidthClass="max-w-7xl"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-primary/10 bg-secondary/30">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
            <Workflow className="w-5 h-5 text-violet-400" />
          </div>
          <div>
            <h2 id="activity-diagram-title" className="text-base font-semibold text-foreground/90">{titleOverride || templateName}</h2>
            <p className="text-sm text-muted-foreground/90">
              {subtitleOverride || `${flows.length} use case flow${flows.length !== 1 ? 's' : ''}`}
            </p>
          </div>
        </div>
        <button onClick={onClose} className="w-8 h-8 rounded-lg bg-secondary/50 hover:bg-secondary flex items-center justify-center transition-colors" aria-label="Close dialog">
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
            {t.templates.diagrams.no_flow_data}
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
    </BaseModal>
  );
}
