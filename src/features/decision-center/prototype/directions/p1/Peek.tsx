/**
 * Level 2 — the peek: an anchored list under the chip. Light to open, light
 * to dismiss (Esc, click outside, the chip again — owned by the Hub via
 * useClickOutside). ↑/↓ focus, Enter opens the
 * modal, A/R/D decide the focused row in place.
 */
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { OVERLAY_DISMISS_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { Button } from '@/features/shared/components/buttons';
import type { ChipCount, DecisionItem, HubChip } from '../../../model/decisionModel';
import type { PrototypeVerdict } from '../../directionContract';
import { COPY } from './copy';
import { KeyHint } from './Kbd';
import { CHIP_ICON, EASE_OUT, isTypingTarget } from './meta';
import { PeekRow, peekKeysFor } from './PeekRow';

interface PeekProps {
  chip: HubChip;
  rows: DecisionItem[];
  count: ChipCount;
  anchor: { left: number; top: number };
  keysEnabled: boolean;
  onOpen: (item: DecisionItem, el: HTMLElement | null) => void;
  onDecide: (v: PrototypeVerdict) => void;
}

export function Peek({ chip, rows, count, anchor, keysEnabled, onOpen, onDecide }: PeekProps) {
  const reduce = useReducedMotion();
  const [focus, setFocus] = useState(0);
  const [armed, setArmed] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const ready = chip === 'ready';
  const Icon = CHIP_ICON[chip];
  const at = Math.min(focus, Math.max(0, rows.length - 1));
  const current = rows[at];
  const currentKeys = current ? peekKeysFor(current, ready) : null;

  useEffect(() => { setArmed(null); }, [current?.id]);
  useEffect(() => {
    if (!current) return;
    document.getElementById(`p1-peek-${current.id}`)?.scrollIntoView({ block: 'nearest' });
  }, [current]);

  const rowEl = (item: DecisionItem) => document.getElementById(`p1-peek-${item.id}`);
  const needsModal = (item: DecisionItem) => !!item.input || item.kind === 'council';

  useAppKeyboard((e) => {
    if (isTypingTarget(e.target) || e.ctrlKey || e.metaKey || e.altKey) return false;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k === 'ArrowDown') { setFocus(Math.min(at + 1, rows.length - 1)); return true; }
    if (k === 'ArrowUp') { setFocus(Math.max(at - 1, 0)); return true; }
    if (!current) return false;
    const keys = currentKeys ?? {};
    if (k === 'Enter') {
      e.preventDefault();
      if (armed === current.id) { onDecide({ item: current, verdict: 'reject' }); setArmed(null); }
      else onOpen(current, rowEl(current));
      return true;
    }
    if (k === 'a' && keys.accept) {
      if (needsModal(current)) onOpen(current, rowEl(current));
      else onDecide({ item: current, verdict: 'accept' });
      return true;
    }
    if (k === 'r' && keys.reject) { setArmed(current.id); return true; }
    if (k === 'd' && keys.done) { onDecide({ item: current, verdict: 'done' }); return true; }
    return false;
  }, { priority: OVERLAY_DISMISS_PRIORITY, enabled: keysEnabled });

  return (
    <motion.div
      className="p1-peek"
      style={{ left: anchor.left, top: anchor.top }}
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.98, transition: { duration: 0.12 } }}
      transition={{ duration: 0.18, ease: EASE_OUT }}
      data-testid="p1-peek"
    >
      <div className="flex items-center gap-2 border-b p1-hair px-3.5 py-2.5">
        <Icon className="h-4 w-4 text-primary" aria-hidden />
        <span className="typo-heading text-foreground">{COPY.chip[chip]}</span>
        <span className="typo-data tabular-nums text-foreground">{count.failed ? '—' : rows.length}</span>
        <span className="min-w-0 flex-1 truncate typo-caption">{COPY.chipHint[chip]}</span>
        {ready && rows.length > 0 && (
          <Button
            variant="accent" tone="success" size="xs"
            onClick={() => rows.forEach((item) => onDecide({ item, verdict: 'accept' }))}
          >
            {COPY.peek.dispatchAll}
          </Button>
        )}
      </div>
      <div ref={listRef} role="listbox" aria-label={COPY.chip[chip]} aria-activedescendant={current ? `p1-peek-${current.id}` : undefined} className="max-h-[22rem] overflow-y-auto py-1">
        {count.failed && <p className="px-4 py-3 typo-body text-status-error">{COPY.peek.failed}</p>}
        {!count.failed && rows.length === 0 && <p className="px-4 py-3 typo-body text-foreground">{COPY.peek.clear}</p>}
        <AnimatePresence initial={!reduce} mode="popLayout">
          {rows.map((item, i) => (
            <PeekRow
              key={item.id}
              item={item}
              index={i}
              focused={i === at}
              armed={armed === item.id}
              first={i === 0 && !ready}
              ready={ready}
              reduce={reduce}
              onFocus={() => setFocus(i)}
              onOpen={(el) => onOpen(item, el)}
              onDispatch={() => onDecide({ item, verdict: 'accept' })}
            />
          ))}
        </AnimatePresence>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t p1-hair p1-band px-3.5 py-2">
        <KeyHint keys={['↑', '↓']} label={COPY.peek.walk} />
        <KeyHint keys={['⏎']} label={COPY.peek.openKey} />
        {currentKeys?.accept && <KeyHint keys={['A']} label={currentKeys.accept} />}
        {currentKeys?.reject && <KeyHint keys={['R']} label={currentKeys.reject} />}
        {currentKeys?.done && <KeyHint keys={['D']} label={currentKeys.done} />}
        <KeyHint keys={['Esc']} label={COPY.peek.close} />
      </div>
    </motion.div>
  );
}
