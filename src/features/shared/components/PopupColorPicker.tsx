import { useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Palette } from 'lucide-react';
import { useClickOutside } from '@/hooks/utility/useClickOutside';
import { ColorPicker } from '@/features/shared/components/ColorPicker';

interface PopupColorPickerProps {
  value: string;
  onChange: (color: string) => void;
  size?: 'sm' | 'md';
}

export function PopupColorPicker({ value, onChange, size = 'sm' }: PopupColorPickerProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useClickOutside(containerRef, open, close);

  const handlePresetChange = (color: string) => {
    onChange(color);
    // Close on preset click, stay open for custom hex
    if (color.startsWith('#') && color.length === 7) {
      setOpen(false);
    }
  };

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className={`w-10 h-10 rounded-lg border flex items-center justify-center transition-all ${
          open
            ? 'border-primary/40 ring-2 ring-primary/20'
            : 'border-primary/15 hover:border-primary/30 hover:scale-105'
        }`}
        title="Choose color"
      >
        {value ? (
          <div
            className="w-6 h-6 rounded-md"
            style={{ backgroundColor: value }}
          />
        ) : (
          <Palette className="w-4 h-4 text-muted-foreground/60" />
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="absolute top-full mt-1 left-0 bg-background border border-primary/15 rounded-xl shadow-lg z-20 p-3 min-w-[280px]"
          >
            <ColorPicker
              value={value}
              onChange={handlePresetChange}
              size={size}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
