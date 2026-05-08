import { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';

export type SortDirection = 'asc' | 'desc' | null;

interface SortableColumnHeaderProps {
  label: string;
  direction: SortDirection;
  onToggle: () => void;
  align?: 'left' | 'right';
}

/**
 * Restart the `sort-pulse` CSS animation on the given element. Used so
 * grids can flash a subtle background pulse on the column whose sort
 * just changed — keyframes live in globals.css.
 */
export function columnSortPulse(element: HTMLElement | null): void {
  if (!element) return;
  element.classList.remove('animate-sort-pulse');
  // Force reflow so re-adding the class restarts the animation.
  void element.offsetWidth;
  element.classList.add('animate-sort-pulse');
}

export function SortableColumnHeader({ label, direction, onToggle, align = 'left' }: SortableColumnHeaderProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const prevDirection = useRef<SortDirection>(direction);
  const isSorted = direction !== null;

  useEffect(() => {
    if (prevDirection.current !== direction) {
      columnSortPulse(buttonRef.current);
      prevDirection.current = direction;
    }
  }, [direction]);

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onToggle}
      className={`group relative flex items-center gap-1.5 typo-label rounded-interactive px-1 -mx-1 transition-colors ${align === 'right' ? 'justify-end ml-auto' : ''} ${isSorted ? 'text-primary' : 'text-foreground hover:text-foreground'}`}
    >
      <span>{label}</span>
      <span className="relative inline-flex w-3 h-3 items-center justify-center">
        {direction === null ? (
          <ArrowUpDown className="w-3 h-3 text-foreground opacity-30 group-hover:opacity-60 transition-opacity duration-150" />
        ) : (
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={direction}
              initial={{ y: 8, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -8, opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className="absolute inset-0 inline-flex items-center justify-center"
            >
              {direction === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
            </motion.span>
          </AnimatePresence>
        )}
      </span>
    </button>
  );
}
