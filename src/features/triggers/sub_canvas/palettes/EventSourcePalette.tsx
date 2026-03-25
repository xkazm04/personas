import { useEffect, useRef, useState, type DragEvent } from 'react';
import { ChevronDown, ChevronUp, Zap } from 'lucide-react';
import {
  EVENT_SOURCE_CATEGORIES,
  type EventSourceTemplate,
} from '../libs/eventCanvasConstants';
import { setDragPayload, clearDragPayload, CANVAS_DND_MIME } from '../hooks/useEventCanvasDragDrop';

interface Props {
  onCanvasEventTypes: Set<string>;
}

/**
 * Inline button + dropdown panel for system event sources.
 * Sits in the top-left toolbar row alongside sidebar toggle and refresh.
 */
export function SystemEventsToolbar({ onCanvasEventTypes }: Props) {
  const [expanded, setExpanded] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState(0);

  useEffect(() => {
    if (contentRef.current) {
      setContentHeight(contentRef.current.scrollHeight);
    }
  }, [expanded]);

  const allTemplates = EVENT_SOURCE_CATEGORIES
    .filter(c => c.id !== 'marketplace')
    .flatMap(c => c.templates.map(t => ({ ...t, categoryLabel: c.label, categoryColor: c.color })));

  return (
    <div className="relative">
      {/* Toggle button — same style as sibling toolbar buttons */}
      <button
        onClick={() => setExpanded(prev => !prev)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-card/80 backdrop-blur border border-primary/10 hover:bg-secondary/60 transition-colors"
      >
        <Zap className="w-3.5 h-3.5 text-amber-400" />
        <span className="text-[11px] font-medium text-muted-foreground">Events</span>
        {expanded
          ? <ChevronUp className="w-3 h-3 text-muted-foreground/50" />
          : <ChevronDown className="w-3 h-3 text-muted-foreground/50" />
        }
      </button>

      {/* Dropdown panel — full-width, animated slide */}
      <div
        className="fixed mt-1.5 overflow-hidden transition-all duration-200 ease-out z-50"
        style={{
          maxHeight: expanded ? (contentHeight || 200) + 16 : 0,
          opacity: expanded ? 1 : 0,
          pointerEvents: expanded ? 'auto' : 'none',
          left: '80px',
          right: '24px',
          top: 'auto',
        }}
      >
        <div
          ref={contentRef}
          className="flex flex-wrap items-center gap-1.5 p-3 rounded-xl bg-card/95 backdrop-blur-md border border-primary/10 shadow-lg"
        >
          {allTemplates.map(t => (
            <DraggableSourceChip
              key={t.id}
              template={t}
              isOnCanvas={onCanvasEventTypes.has(t.eventType)}
            />
          ))}
          <CustomEventChip />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Draggable chip
// ---------------------------------------------------------------------------

function DraggableSourceChip({ template: t, isOnCanvas }: { template: EventSourceTemplate & { categoryColor: string }; isOnCanvas: boolean }) {
  const onDragStart = (e: DragEvent) => {
    setDragPayload('event', t.eventType);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(CANVAS_DND_MIME, t.eventType);
    e.dataTransfer.setData('text/plain', t.eventType);
  };

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={clearDragPayload}
      className={`
        flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg cursor-grab active:cursor-grabbing
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
// Custom event type chip
// ---------------------------------------------------------------------------

function CustomEventChip() {
  const [value, setValue] = useState('');

  const onDragStart = (e: DragEvent) => {
    if (!value.trim()) { e.preventDefault(); return; }
    setDragPayload('event', value.trim());
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(CANVAS_DND_MIME, value.trim());
    e.dataTransfer.setData('text/plain', value.trim());
  };

  return (
    <div
      draggable={!!value.trim()}
      onDragStart={onDragStart}
      onDragEnd={clearDragPayload}
      className="flex items-center gap-1 rounded-lg border border-dashed border-primary/10 hover:border-primary/20 transition-colors"
    >
      <input
        type="text"
        value={value}
        onChange={e => setValue(e.target.value)}
        placeholder="custom_event"
        className="w-24 px-2 py-1.5 text-[10px] rounded-lg bg-transparent text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:w-32 transition-all"
      />
      {value.trim() && (
        <span className="text-[9px] text-muted-foreground/40 pr-1.5 cursor-grab whitespace-nowrap">drag</span>
      )}
    </div>
  );
}

export { SystemEventsToolbar as EventSourcePalette };
