import { useEffect, useRef } from 'react';
import { Trash2, X } from 'lucide-react';
import { EVENT_EDGE_TYPES } from '../libs/eventCanvasConstants';

interface Props {
  x: number;
  y: number;
  currentType: string;
  eventType: string;
  onChangeType: (type: string) => void;
  onDelete: () => void;
  onClose: () => void;
}

export function EdgeTooltip({ x, y, currentType, eventType, onChangeType, onDelete, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as HTMLElement)) onClose();
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  // Clamp to viewport
  const clampedX = Math.min(x, window.innerWidth - 240);
  const clampedY = Math.min(y, window.innerHeight - 260);

  return (
    <div
      ref={ref}
      className="fixed z-[100] w-[220px] rounded-modal bg-card border border-primary/15 shadow-elevation-4 overflow-hidden"
      style={{ left: clampedX, top: clampedY }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-primary/10">
        <span className="text-[10px] text-foreground truncate max-w-[160px]">{eventType}</span>
        <button onClick={onClose} className="p-0.5 rounded hover:bg-secondary/60">
          <X className="w-3 h-3 text-foreground" />
        </button>
      </div>

      {/* Type selector */}
      <div className="p-2 space-y-1">
        <span className="text-[9px] text-foreground uppercase tracking-wider px-1">Routing</span>
        {Object.entries(EVENT_EDGE_TYPES).map(([key, style]) => (
          <button
            key={key}
            onClick={() => onChangeType(key)}
            className={`flex items-center gap-2.5 w-full px-2.5 py-2 rounded-card text-left transition-colors ${
              currentType === key ? 'bg-primary/10 ring-1 ring-primary/20' : 'hover:bg-secondary/50'
            }`}
          >
            {/* Color line sample */}
            <svg width="24" height="3" className="flex-shrink-0">
              <line
                x1="0" y1="1.5" x2="24" y2="1.5"
                stroke={style.stroke}
                strokeWidth={style.strokeWidth}
                strokeDasharray={style.strokeDasharray}
              />
            </svg>
            <div className="flex flex-col min-w-0">
              <span className="text-[11px] font-medium text-foreground">{style.label}</span>
              <span className="text-[9px] text-foreground">{style.description}</span>
            </div>
          </button>
        ))}
      </div>

      {/* Delete */}
      <div className="px-2 pb-2">
        <button
          onClick={onDelete}
          className="flex items-center gap-2 w-full px-2.5 py-2 rounded-card text-xs text-red-400 hover:bg-red-500/10 transition-colors border border-red-500/15"
        >
          <Trash2 className="w-3 h-3" />
          Delete connection
        </button>
      </div>
    </div>
  );
}
