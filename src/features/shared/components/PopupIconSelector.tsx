import { useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Smile } from 'lucide-react';
import { useClickOutside } from '@/hooks/utility/useClickOutside';
import { IconSelector, EMOJI_PRESETS } from '@/features/shared/components/IconSelector';
import type { ConnectorDefinition } from '@/lib/types/types';

interface PopupIconSelectorProps {
  value: string;
  onChange: (icon: string) => void;
  connectors?: ConnectorDefinition[];
  size?: 'sm' | 'md';
}

export function PopupIconSelector({ value, onChange, connectors = [], size = 'sm' }: PopupIconSelectorProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useClickOutside(containerRef, open, close);

  const handleChange = (icon: string) => {
    onChange(icon);
    setOpen(false);
  };

  const isUrl = value?.startsWith('http');
  const isEmoji = EMOJI_PRESETS.includes(value);

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className={`w-10 h-10 rounded-lg border flex items-center justify-center transition-all ${
          open
            ? 'border-primary/40 ring-2 ring-primary/20 bg-primary/8'
            : 'border-primary/15 bg-background/50 hover:border-primary/30 hover:bg-secondary/40'
        }`}
        title="Choose icon"
      >
        {value ? (
          isUrl ? (
            <img src={value} alt="" className="w-5 h-5 rounded" />
          ) : isEmoji ? (
            <span className="text-lg leading-none">{value}</span>
          ) : (
            <span className="text-lg leading-none">{value}</span>
          )
        ) : (
          <Smile className="w-4 h-4 text-muted-foreground/60" />
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="absolute top-full mt-1 left-0 bg-background border border-primary/15 rounded-xl shadow-lg z-20 p-3 min-w-[260px]"
          >
            <IconSelector
              value={value}
              onChange={handleChange}
              connectors={connectors}
              size={size}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
