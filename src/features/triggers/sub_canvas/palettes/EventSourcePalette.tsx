import { useState, type DragEvent } from 'react';
import { ChevronDown, ChevronUp, Zap } from 'lucide-react';
import {
  EVENT_SOURCE_CATEGORIES,
  type EventSourceTemplate,
} from '../libs/eventCanvasConstants';
import { DRAG_TYPE_EVENT_SOURCE } from '../hooks/useEventCanvasDragDrop';

interface Props {
  onCanvasEventTypes: Set<string>;
}

/**
 * Top overlay toolbar showing system event sources (triggers, execution, system).
 * Renders as a collapsible horizontal strip at the top of the canvas.
 */
export function SystemEventsToolbar({ onCanvasEventTypes }: Props) {
  const [expanded, setExpanded] = useState(false);

  // Combine all non-marketplace categories into a flat list
  const allTemplates = EVENT_SOURCE_CATEGORIES
    .filter(c => c.id !== 'marketplace')
    .flatMap(c => c.templates.map(t => ({ ...t, categoryLabel: c.label, categoryColor: c.color })));

  return (
    <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10">
      {/* Toggle button */}
      <button
        onClick={() => setExpanded(prev => !prev)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-card/90 backdrop-blur-md border border-primary/10 shadow-sm hover:bg-card transition-colors"
      >
        <Zap className="w-3 h-3 text-amber-400" />
        <span className="text-[11px] font-medium text-muted-foreground">System Events</span>
        {expanded
          ? <ChevronUp className="w-3 h-3 text-muted-foreground/50" />
          : <ChevronDown className="w-3 h-3 text-muted-foreground/50" />
        }
      </button>

      {/* Expanded toolbar */}
      {expanded && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1 px-2.5 py-2 rounded-xl bg-card/95 backdrop-blur-md border border-primary/10 shadow-lg max-w-[700px]">
          {allTemplates.map(t => (
            <DraggableSourceChip
              key={t.id}
              template={t}
              isOnCanvas={onCanvasEventTypes.has(t.eventType)}
            />
          ))}

          {/* Custom event type */}
          <CustomEventChip />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Draggable chip
// ---------------------------------------------------------------------------

function DraggableSourceChip({ template: t, isOnCanvas }: { template: EventSourceTemplate & { categoryColor: string }; isOnCanvas: boolean }) {
  const onDragStart = (e: DragEvent) => {
    e.dataTransfer.setData(DRAG_TYPE_EVENT_SOURCE, t.eventType);
    e.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div
      draggable
      onDragStart={onDragStart}
      className={`
        flex items-center gap-1.5 px-2 py-1 rounded-lg cursor-grab active:cursor-grabbing
        bg-secondary/40 hover:bg-secondary/70 border border-primary/5 hover:border-primary/15
        transition-colors select-none
        ${isOnCanvas ? 'opacity-40' : ''}
      `}
      title={t.description}
    >
      <t.icon className={`w-3 h-3 flex-shrink-0 ${t.color}`} />
      <span className="text-[10px] font-medium text-foreground/80 whitespace-nowrap">{t.label}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Custom event type chip with inline input
// ---------------------------------------------------------------------------

function CustomEventChip() {
  const [value, setValue] = useState('');

  const onDragStart = (e: DragEvent) => {
    if (!value.trim()) { e.preventDefault(); return; }
    e.dataTransfer.setData(DRAG_TYPE_EVENT_SOURCE, value.trim());
    e.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div
      draggable={!!value.trim()}
      onDragStart={onDragStart}
      className="flex items-center gap-1 rounded-lg border border-dashed border-primary/10 hover:border-primary/20 transition-colors"
    >
      <input
        type="text"
        value={value}
        onChange={e => setValue(e.target.value)}
        placeholder="custom_event"
        className="w-24 px-2 py-1 text-[10px] rounded-lg bg-transparent text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:w-32 transition-all"
      />
      {value.trim() && (
        <span className="text-[9px] text-muted-foreground/40 pr-1.5 cursor-grab whitespace-nowrap">drag</span>
      )}
    </div>
  );
}

// Re-export for backward compat — old name
export { SystemEventsToolbar as EventSourcePalette };
