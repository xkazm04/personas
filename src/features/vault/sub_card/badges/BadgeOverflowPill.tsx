import { useState, useRef, useEffect, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export interface BadgeEntry {
  key: string;
  label: string;
  node: ReactNode;
}

export function BadgeOverflowPill({ badges }: { badges: BadgeEntry[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div
      className="relative"
      ref={ref}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className="text-sm font-medium px-1.5 py-0.5 rounded-full bg-secondary/50 border border-primary/10 text-muted-foreground/60 hover:text-muted-foreground/80 hover:border-primary/20 transition-colors shrink-0"
      >
        +{badges.length}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="absolute left-0 top-full mt-1.5 z-30 min-w-[160px] rounded-lg bg-background border border-primary/15 shadow-xl py-1.5"
            onClick={(e) => e.stopPropagation()}
          >
            {badges.map((b) => (
              <div key={b.key} className="flex items-center gap-2 px-3 py-1">
                {b.node}
                <span className="text-sm text-muted-foreground/70">{b.label}</span>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
