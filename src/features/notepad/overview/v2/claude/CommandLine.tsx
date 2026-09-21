// The desk's ONE line — Write and Find are two modes of the same field.
//
//   Write  (default) the baseline capture line: Enter keeps the text as a draft
//          in the selected project.
//   Find   a live fuzzy filter over title + body. Enter opens the selected card;
//          with zero matches Enter keeps the query as a new draft instead, so a
//          search that finds nothing is one keystroke from being the note.
//
// Switching: `/` typed into an empty Write line (or pressed anywhere on the
// desk) flips to Find; Backspace on an empty Find line flips back; Escape clears
// a query first and only then steps out. ArrowDown hands the keyboard to the
// grid without clearing anything.
import { forwardRef, type KeyboardEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { PenLine, Search } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';

import { COPY } from './copy';
import { Keycap } from './Keycap';

export type LineMode = 'write' | 'find';

interface CommandLineProps {
  mode: LineMode;
  capture: string;
  query: string;
  atCap: boolean;
  slotCount: number;
  shown: number;
  total: number;
  onCaptureChange: (value: string) => void;
  onQueryChange: (value: string) => void;
  onModeChange: (mode: LineMode) => void;
  /** Write: keep the capture. Find: open the selection (or keep the query as a draft). */
  onSubmit: () => void;
  /** ArrowDown: leave the line for the grid. */
  onDropToGrid: () => void;
  /** Escape on an empty Find line: back to Write and out of the field. */
  onStepOut: () => void;
}

export const CommandLine = forwardRef<HTMLInputElement, CommandLineProps>(function CommandLine(
  {
    mode,
    capture,
    query,
    atCap,
    slotCount,
    shown,
    total,
    onCaptureChange,
    onQueryChange,
    onModeChange,
    onSubmit,
    onDropToGrid,
    onStepOut,
  },
  ref,
) {
  const { t, tx } = useTranslation();
  const reduced = useReducedMotion();
  const finding = mode === 'find';
  const value = finding ? query : capture;
  const writeBlocked = !finding && atCap;
  const placeholder = finding
    ? COPY.find_placeholder
    : atCap
      ? tx(t.notepad.cap_reached, { count: slotCount })
      : t.notepad.overview_capture_placeholder;

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === '/' && !finding && capture === '') {
      e.preventDefault();
      onModeChange('find');
      return;
    }
    if (e.key === 'Backspace' && finding && query === '') {
      e.preventDefault();
      onModeChange('write');
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      onDropToGrid();
      return;
    }
    if (e.key === 'Escape' && finding) {
      // Consumed either way, so the pad's ladder (which stops at a prevented
      // event) does not also blur or close.
      e.preventDefault();
      if (query) onQueryChange('');
      else onStepOut();
    }
  };

  const spring = reduced ? { duration: 0 } : { type: 'spring' as const, stiffness: 520, damping: 34 };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      data-mode={mode}
      className={`group/line relative flex items-center gap-3 pl-2 pr-3 rounded-card border transition-[border-color,background-color,box-shadow] duration-200 ${
        finding
          ? 'border-status-info/35 bg-status-info/5 focus-within:border-status-info/60 focus-within:shadow-elevation-2'
          : 'border-primary/15 bg-secondary/15 focus-within:border-primary/40 focus-within:shadow-elevation-2'
      }`}
    >
      {/* The mode chip: a click flips the mode, like `/` does. */}
      <button
        type="button"
        onClick={() => onModeChange(finding ? 'write' : 'find')}
        aria-pressed={finding}
        aria-label={finding ? COPY.mode_find : COPY.mode_write}
        data-testid="notepad-v2c-line-mode"
        className={`relative shrink-0 h-8 px-2.5 rounded-interactive flex items-center gap-1.5 typo-label overflow-hidden focus-ring transition-colors ${
          finding ? 'bg-status-info/15 text-status-info' : 'bg-primary/10 text-primary'
        }`}
      >
        <AnimatePresence initial={false} mode="popLayout">
          <motion.span
            key={mode}
            className="flex items-center gap-1.5"
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: finding ? 12 : -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: finding ? -12 : 12 }}
            transition={spring}
          >
            {finding ? <Search className="w-3.5 h-3.5" aria-hidden /> : <PenLine className="w-3.5 h-3.5" aria-hidden />}
            {finding ? COPY.mode_find : COPY.mode_write}
          </motion.span>
        </AnimatePresence>
      </button>

      <input
        ref={ref}
        type="text"
        value={value}
        onChange={(e) => (finding ? onQueryChange(e.target.value) : onCaptureChange(e.target.value))}
        onKeyDown={onKeyDown}
        disabled={writeBlocked}
        placeholder={placeholder}
        aria-label={finding ? COPY.find_placeholder : t.notepad.overview_capture_placeholder}
        data-testid={finding ? 'notepad-v2c-find' : 'notepad-overview-capture'}
        className="flex-1 min-w-0 h-14 bg-transparent typo-body-lg text-foreground placeholder:text-foreground/50 outline-none disabled:is-disabled"
      />

      <div className="shrink-0 flex items-center gap-2 typo-caption text-foreground/85">
        <AnimatePresence initial={false} mode="popLayout">
          {finding ? (
            <motion.span
              key="count"
              className="flex items-center gap-2"
              initial={reduced ? { opacity: 0 } : { opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, x: 8 }}
              transition={spring}
            >
              {query && (
                <span className={`tabular-nums typo-data ${shown === 0 ? 'text-status-warning' : 'text-status-info'}`} data-testid="notepad-v2c-find-count">
                  {tx(COPY.find_count, { shown, total })}
                </span>
              )}
              <Keycap>↵</Keycap>
              <span>{t.notepad.menu_open}</span>
              <Keycap>{COPY.keycap_esc}</Keycap>
            </motion.span>
          ) : (
            <motion.span
              key="hints"
              className="flex items-center gap-2"
              initial={reduced ? { opacity: 0 } : { opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, x: -8 }}
              transition={spring}
            >
              <Keycap>↵</Keycap>
              <span>{COPY.hint_keep}</span>
              <Keycap className="ml-1">/</Keycap>
              <span>{COPY.hint_find}</span>
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    </form>
  );
});
