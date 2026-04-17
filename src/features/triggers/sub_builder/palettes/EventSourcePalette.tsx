import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Zap } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import {
  EVENT_SOURCE_CATEGORIES,
  type EventSourceTemplate,
} from '../libs/eventCanvasConstants';
import { setPendingItem } from '../hooks/useEventCanvasDragDrop';

interface Props {
  onCanvasEventTypes: Set<string>;
  onStartPointerDrag: (type: 'event' | 'persona', value: string, label: string) => void;
}

export function SystemEventsToolbar({ onCanvasEventTypes, onStartPointerDrag }: Props) {
  const { t } = useTranslation();
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
      <button
        onClick={() => setExpanded(prev => !prev)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-input bg-card border border-primary/10 hover:bg-secondary/60 transition-colors"
      >
        <Zap className="w-3.5 h-3.5 text-amber-400" />
        <span className="text-[11px] font-medium text-muted-foreground">{t.triggers.builder.events}</span>
        {expanded
          ? <ChevronUp className="w-3 h-3 text-muted-foreground/50" />
          : <ChevronDown className="w-3 h-3 text-muted-foreground/50" />
        }
      </button>

      {/* Dropdown — absolute to this toolbar button, not fixed to viewport */}
      <div
        className="absolute top-full left-0 mt-1.5 overflow-hidden transition-all duration-200 ease-out z-[60]"
        style={{
          maxHeight: expanded ? (contentHeight || 200) + 16 : 0,
          opacity: expanded ? 1 : 0,
          pointerEvents: expanded ? 'auto' : 'none',
        }}
      >
        <div
          ref={contentRef}
          className="flex flex-wrap items-center gap-1.5 p-3 rounded-modal bg-card border border-primary/10 shadow-elevation-3 w-max max-w-[600px]"
        >
          {allTemplates.map(t => (
            <SourceChip
              key={t.id}
              template={t}
              isOnCanvas={onCanvasEventTypes.has(t.eventType)}
              onStartPointerDrag={onStartPointerDrag}
            />
          ))}
          <CustomEventChip />
        </div>
      </div>
    </div>
  );
}

function SourceChip({ template: t, isOnCanvas, onStartPointerDrag }: {
  template: EventSourceTemplate & { categoryColor: string };
  isOnCanvas: boolean;
  onStartPointerDrag: (type: 'event' | 'persona', value: string, label: string) => void;
}) {
  return (
    <div
      onPointerDown={(e) => {
        if (e.button === 0) {
          e.preventDefault();
          onStartPointerDrag('event', t.eventType, t.label);
        }
      }}
      onClick={() => setPendingItem('event', t.eventType)}
      className={`
        flex items-center gap-1.5 px-2.5 py-1.5 rounded-card
        cursor-grab active:cursor-grabbing
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

function CustomEventChip() {
  const { t } = useTranslation();
  const [value, setValue] = useState('');

  return (
    <div className="flex items-center gap-1 rounded-card border border-dashed border-primary/10 hover:border-primary/20 transition-colors">
      <input
        type="text"
        value={value}
        onChange={e => setValue(e.target.value)}
        placeholder={t.triggers.builder.custom_event_placeholder}
        className="w-24 px-2 py-1.5 text-[10px] rounded-card bg-transparent text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:w-32 transition-all"
      />
      {value.trim() && (
        <button
          onClick={() => { setPendingItem('event', value.trim()); setValue(''); }}
          className="text-[9px] text-primary/60 hover:text-primary pr-2 cursor-pointer"
        >
          add
        </button>
      )}
    </div>
  );
}

export { SystemEventsToolbar as EventSourcePalette };
