import { useState, useRef, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { ColorPicker } from '@/features/shared/components/forms/ColorPicker';
import { useClickOutside } from '@/hooks/utility/interaction/useClickOutside';

// ---------------------------------------------------------------------------
// Inline popup color picker — compact swatch that opens palette on click
// ---------------------------------------------------------------------------

export function ColorRow({
  label,
  value,
  derivedValue,
  onChange,
}: {
  label: string;
  value: string | null;
  derivedValue: string | undefined;
  onChange: (color: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useClickOutside(ref, open, close);

  const displayValue = value ?? derivedValue ?? '#888888';
  const isOverridden = value !== null;

  return (
    <div ref={ref} className="relative flex items-center gap-3 py-1.5">
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className={`w-7 h-7 rounded-lg border flex-shrink-0 transition-all cursor-pointer ${
          open
            ? 'border-primary/40 ring-2 ring-primary/20'
            : 'border-primary/15 hover:border-primary/30 hover:scale-105'
        }`}
        style={{ backgroundColor: displayValue }}
        title={`Pick ${label}`}
      />
      <span className="text-xs font-medium text-muted-foreground/80 w-24 flex-shrink-0">{label}</span>
      <span className={`text-xs font-mono flex-1 min-w-0 truncate ${isOverridden ? 'text-foreground/70' : 'text-muted-foreground/40'}`}>
        {displayValue}
      </span>
      {isOverridden && (
        <button
          type="button"
          onClick={() => onChange(null)}
          className="p-1 rounded-md text-muted-foreground/40 hover:text-muted-foreground/80 hover:bg-primary/5 transition-colors flex-shrink-0"
          title="Reset to auto"
        >
          <X className="w-3 h-3" />
        </button>
      )}
      {!isOverridden && (
        <span className="text-[10px] text-muted-foreground/30 flex-shrink-0">auto</span>
      )}

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="absolute top-full mt-1 left-0 glass-sm rounded-xl shadow-elevation-3 z-50 p-3 min-w-[280px]"
          >
            <ColorPicker
              value={displayValue}
              onChange={(c) => onChange(c)}
              size="sm"
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
