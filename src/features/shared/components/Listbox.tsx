import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useClickOutside } from '@/hooks/utility/useClickOutside';

interface ListboxProps {
  /** Render the trigger element. Consumer handles click via toggle(). */
  renderTrigger: (props: { isOpen: boolean; toggle: () => void }) => ReactNode;
  /** Render the dropdown options. */
  children: (props: { close: () => void; focusIndex: number }) => ReactNode;
  /** Total selectable items — enables ArrowUp/Down keyboard navigation. */
  itemCount?: number;
  /** Called when Enter is pressed on a focused item (0-based index). */
  onSelectFocused?: (index: number) => void;
  /** Accessible label for the listbox popup. */
  ariaLabel?: string;
  /** Additional classes on the root container. */
  className?: string;
}

export function Listbox({
  renderTrigger,
  children,
  itemCount,
  onSelectFocused,
  ariaLabel,
  className,
}: ListboxProps) {
  const [open, setOpen] = useState(false);
  const [focusIndex, setFocusIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((prev) => !prev), []);
  useClickOutside(containerRef, open, close);

  // Reset focus index when opening
  useEffect(() => {
    if (open) setFocusIndex(-1);
  }, [open]);

  // Arrow key navigation + Enter selection
  useEffect(() => {
    if (!open || itemCount == null) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusIndex((i) => Math.min(i + 1, itemCount - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' && focusIndex >= 0) {
        e.preventDefault();
        onSelectFocused?.(focusIndex);
        setOpen(false);
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, focusIndex, itemCount, onSelectFocused]);

  return (
    <div ref={containerRef} className={`relative${className ? ` ${className}` : ''}`}>
      {renderTrigger({ isOpen: open, toggle })}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="absolute top-full mt-1 left-0 right-0 bg-background border border-primary/15 rounded-xl shadow-lg z-20 overflow-hidden"
            role="listbox"
            aria-label={ariaLabel}
          >
            {children({ close, focusIndex })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
