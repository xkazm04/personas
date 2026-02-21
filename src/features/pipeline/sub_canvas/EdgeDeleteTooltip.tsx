import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Trash2, X } from 'lucide-react';
import { CONNECTION_TYPE_STYLES, getConnectionStyle } from './teamConstants';

interface EdgeDeleteTooltipProps {
  x: number;
  y: number;
  connectionType: string;
  label: string;
  onDelete: () => void;
  onChangeType: (type: string) => void;
  onClose: () => void;
}

const CONNECTION_TYPES = Object.entries(CONNECTION_TYPE_STYLES).map(([value, style]) => ({
  value,
  label: style.label,
  stroke: style.stroke,
  strokeDasharray: style.strokeDasharray,
}));

export default function EdgeDeleteTooltip({
  x,
  y,
  connectionType,
  label,
  onDelete,
  onChangeType,
  onClose,
}: EdgeDeleteTooltipProps) {
  const ref = useRef<HTMLDivElement>(null);
  const style = getConnectionStyle(connectionType);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.85 }}
      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      className="fixed z-50 flex flex-col gap-2 p-3 rounded-xl bg-secondary/95 backdrop-blur-md border border-primary/15 shadow-xl shadow-black/20 min-w-[180px]"
      style={{ left: x, top: y, transform: 'translate(-50%, -120%)' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div
            className="w-2.5 h-2.5 rounded-full"
            style={{ backgroundColor: style.stroke }}
          />
          <span className="text-xs font-medium text-foreground/80">
            {label || style.label}
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-0.5 rounded-md text-muted-foreground/40 hover:text-foreground/70 hover:bg-secondary/80 transition-colors"
        >
          <X className="w-3 h-3" />
        </button>
      </div>

      {/* Connection type picker */}
      <div className="flex flex-col gap-0.5">
        <span className="text-[9px] uppercase font-mono text-muted-foreground/50 tracking-wider px-1 mb-0.5">
          Connection Type
        </span>
        {CONNECTION_TYPES.map((ct) => {
          const isActive = ct.value === connectionType;
          return (
            <button
              key={ct.value}
              onClick={() => {
                if (!isActive) onChangeType(ct.value);
              }}
              className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs transition-all ${
                isActive
                  ? 'bg-primary/10 text-foreground/90'
                  : 'text-foreground/60 hover:bg-primary/5 hover:text-foreground/80'
              }`}
            >
              {/* Visual line sample */}
              <svg width="20" height="8" className="shrink-0">
                <line
                  x1="0"
                  y1="4"
                  x2="20"
                  y2="4"
                  stroke={ct.stroke}
                  strokeWidth={isActive ? 2.5 : 2}
                  strokeDasharray={ct.strokeDasharray}
                  strokeLinecap="round"
                />
              </svg>
              <span className="font-medium">{ct.label}</span>
              {isActive && (
                <div
                  className="ml-auto w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: ct.stroke }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Divider */}
      <div className="border-t border-primary/10" />

      {/* Delete button */}
      <button
        onClick={onDelete}
        className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg text-red-400 hover:bg-red-500/15 border border-red-500/20 bg-red-500/5 transition-colors"
      >
        <Trash2 className="w-3 h-3" />
        Delete Connection
      </button>
    </motion.div>
  );
}
