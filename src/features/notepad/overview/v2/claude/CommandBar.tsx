// The desk's status line: which mode the keyboard is in, which note the cursor
// is on, and the keys that do something to THAT note right now — every chip is
// also a button, so the bar teaches the key map by being the mouse path too.
import { AnimatePresence, motion } from 'framer-motion';
import { Keyboard } from 'lucide-react';

import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { DevNote } from '@/lib/bindings/DevNote';
import { useTranslation } from '@/i18n/useTranslation';

import { noteStatusMeta } from '../../../noteStatusMeta';
import { COPY } from './copy';
import { Keycap } from './Keycap';

export type DeskMode = 'browse' | 'find' | 'write';

export interface DeskChip {
  id: string;
  keyFace: string;
  label: string;
  tone?: 'default' | 'accent' | 'warning';
  /** A count shown after the label (unread entries). */
  count?: number;
  onRun: () => void;
}

const MODE_TONE: Record<DeskMode, string> = {
  browse: 'bg-primary/12 text-primary border-primary/25',
  find: 'bg-status-info/12 text-status-info border-status-info/30',
  write: 'bg-brand-purple/12 text-brand-purple border-brand-purple/30',
};

export function CommandBar({
  mode,
  selected,
  chips,
  keysOpen,
  onToggleKeys,
}: {
  mode: DeskMode;
  selected: DevNote | null;
  chips: readonly DeskChip[];
  keysOpen: boolean;
  onToggleKeys: () => void;
}) {
  const { t } = useTranslation();
  const reduced = useReducedMotion();
  const spring = reduced ? { duration: 0 } : { type: 'spring' as const, stiffness: 480, damping: 34 };
  const modeLabel = mode === 'find' ? COPY.mode_find : mode === 'write' ? COPY.mode_write : COPY.mode_browse;
  const meta = selected ? noteStatusMeta(selected.status) : null;

  return (
    <div
      className="relative shrink-0 h-12 px-6 flex items-center gap-3 border-t border-primary/10 bg-secondary/15 backdrop-blur-md"
      data-testid="notepad-v2c-command-bar"
    >
      <motion.span
        layout={!reduced}
        transition={spring}
        className={`shrink-0 h-6 px-2 rounded-interactive border flex items-center typo-label transition-colors duration-200 ${MODE_TONE[mode]}`}
        data-testid="notepad-v2c-mode"
        data-mode={mode}
      >
        <AnimatePresence initial={false} mode="popLayout">
          <motion.span
            key={mode}
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -8 }}
            transition={spring}
          >
            {modeLabel}
          </motion.span>
        </AnimatePresence>
      </motion.span>

      <div className="min-w-0 flex-1 flex items-center gap-2">
        <AnimatePresence initial={false} mode="popLayout">
          {selected && meta ? (
            <motion.span
              key={selected.id}
              className="min-w-0 flex items-center gap-2"
              initial={reduced ? { opacity: 0 } : { opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, x: 10 }}
              transition={spring}
            >
              <meta.Icon className={`w-3.5 h-3.5 shrink-0 ${meta.tone.text}`} aria-hidden />
              <span className="typo-title text-foreground truncate max-w-[28ch]">{selected.title}</span>
              <span className={`typo-caption shrink-0 ${meta.tone.text}`}>{meta.labelKey(t)}</span>
            </motion.span>
          ) : (
            <motion.span
              key="hint"
              className="flex items-center gap-1.5 typo-caption text-foreground/85"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={reduced ? { duration: 0 } : { duration: 0.15 }}
            >
              <Keycap>↑</Keycap>
              <Keycap>↓</Keycap>
              <Keycap>j</Keycap>
              <Keycap>k</Keycap>
              <span className="ml-1">{COPY.hint_pick}</span>
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      <div className="shrink-0 flex items-center gap-1">
        <AnimatePresence initial={false} mode="popLayout">
          {chips.map((chip) => (
            <motion.button
              key={chip.id}
              type="button"
              layout={!reduced}
              onClick={chip.onRun}
              initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.85 }}
              transition={spring}
              data-testid={`notepad-v2c-chip-${chip.id}`}
              className={`h-7 pl-1 pr-2 rounded-interactive flex items-center gap-1.5 typo-caption transition-colors focus-ring ${
                chip.tone === 'warning'
                  ? 'text-status-warning hover:bg-status-warning/10'
                  : chip.tone === 'accent'
                    ? 'text-primary hover:bg-primary/10'
                    : 'text-foreground hover:bg-secondary/50'
              }`}
            >
              <Keycap tone={chip.tone ?? 'default'}>{chip.keyFace}</Keycap>
              <span className="whitespace-nowrap">{chip.label}</span>
              {chip.count !== undefined && chip.count > 0 && (
                <span className="typo-data tabular-nums text-primary">{chip.count}</span>
              )}
            </motion.button>
          ))}
        </AnimatePresence>

        <span aria-hidden className="mx-1 h-5 w-px bg-primary/15" />
        <Tooltip content={COPY.key_keys} placement="top">
          <button
            type="button"
            onClick={onToggleKeys}
            aria-pressed={keysOpen}
            aria-label={COPY.keys_open}
            data-testid="notepad-v2c-keys-toggle"
            className={`h-7 pl-1.5 pr-2 rounded-interactive flex items-center gap-1.5 typo-caption transition-colors focus-ring ${
              keysOpen ? 'bg-primary/15 text-primary' : 'text-foreground hover:bg-secondary/50'
            }`}
          >
            <Keyboard className="w-3.5 h-3.5" aria-hidden />
            <Keycap tone={keysOpen ? 'accent' : 'default'}>?</Keycap>
          </button>
        </Tooltip>
      </div>
    </div>
  );
}
