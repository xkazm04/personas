import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';

const TYPE_STYLES: Record<string, { stroke: string; label: string }> = {
  sequential: { stroke: '#3b82f6', label: 'Sequential' },
  conditional: { stroke: '#f59e0b', label: 'Conditional' },
  parallel: { stroke: '#10b981', label: 'Parallel' },
  feedback: { stroke: '#8b5cf6', label: 'Feedback' },
};

interface EdgeDeleteTooltipProps {
  x: number;
  y: number;
  connectionType: string;
  label: string;
  onDelete: () => void;
  onClose: () => void;
}

export default function EdgeDeleteTooltip({ x, y, connectionType, label, onDelete, onClose }: EdgeDeleteTooltipProps) {
  const ref = useRef<HTMLDivElement>(null);
  const defaultStyle = { stroke: '#3b82f6', label: 'Sequential' };
  const style = TYPE_STYLES[connectionType] ?? defaultStyle;

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
      className="fixed z-50 flex flex-col gap-2 p-3 rounded-xl bg-secondary/95 backdrop-blur-md border border-primary/15 shadow-xl shadow-black/20"
      style={{ left: x, top: y, transform: 'translate(-50%, -120%)' }}
    >
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

      <button
        onClick={onDelete}
        className="px-3 py-1.5 text-xs font-medium rounded-lg text-red-400 hover:bg-red-500/15 border border-red-500/20 bg-red-500/5 transition-colors"
      >
        Delete Connection
      </button>
    </motion.div>
  );
}
