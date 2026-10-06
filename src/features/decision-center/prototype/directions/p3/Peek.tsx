/**
 * Level 2 — the peek: a drawer pulled out of its chip. Rows in roster order,
 * tier bar on the left, cost on the right; one-key verdicts on the focused row.
 * Its rows carry the same layoutIds as the desk rail, so Enter DOCKS the list:
 * it flies to the desk's left edge instead of vanishing.
 */
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Button } from '@/features/shared/components/buttons';
import { OVERLAY_DISMISS_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import { useClickOutside } from '@/hooks/utility/interaction/useClickOutside';
import { DECISION_CHIPS, modalTypeOf, type DecisionItem, type HubChip } from '../../../model/decisionModel';
import type { PrototypeVerdict } from '../../directionContract';
import { CHIP_META, DUR, EASE, isTypingTarget } from './model';
import { KeyLegend } from './parts';
import { PeekRow } from './PeekRow';

interface Props {
  chip: HubChip;
  /** The chip cell: a press on it is not "outside" (it toggles the peek itself). */
  anchorRef: RefObject<HTMLElement | null>;
  items: DecisionItem[];
  reduced: boolean;
  active: boolean;
  onClose: () => void;
  onOpen: (index: number) => void;
  onSwitch: (chip: HubChip) => void;
  onDecide: (v: PrototypeVerdict) => void;
}

const ORDER: HubChip[] = [...DECISION_CHIPS, 'ready'];

export function Peek({ chip, anchorRef, items, reduced, active, onClose, onOpen, onSwitch, onDecide }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [focus, setFocus] = useState(0);
  const [armed, setArmed] = useState<string | null>(null);
  const ready = chip === 'ready';
  const meta = CHIP_META[chip];
  const Icon = meta.icon;
  const cur = items[Math.min(focus, items.length - 1)];

  useEffect(() => { if (focus > items.length - 1) setFocus(Math.max(0, items.length - 1)); }, [focus, items.length]);
  // The shared dismissal contract: an outside press or Escape closes the peek.
  // The chip cell counts as inside, so pressing the open chip toggles it shut once.
  const insideRefs = useMemo(() => [ref, anchorRef] as const, [anchorRef]);
  useClickOutside(insideRefs, active, onClose);

  const dispatch = (item: DecisionItem) => onDecide({ item, verdict: 'accept' });

  useAppKeyboard((e) => {
    if (isTypingTarget(e.target)) return false;
    const k = e.key.toLowerCase();
    if (e.key === 'ArrowDown') { setFocus((f) => Math.min(items.length - 1, f + 1)); setArmed(null); return true; }
    if (e.key === 'ArrowUp') { setFocus((f) => Math.max(0, f - 1)); setArmed(null); return true; }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const i = ORDER.indexOf(chip) + (e.key === 'ArrowRight' ? 1 : -1);
      onSwitch(ORDER[(i + ORDER.length) % ORDER.length]!);
      return true;
    }
    if (!cur) return false;
    if (e.key === 'Enter') {
      if (armed === cur.id) { onDecide({ item: cur, verdict: 'reject' }); setArmed(null); }
      else if (ready) dispatch(cur);
      else onOpen(Math.min(focus, items.length - 1));
      return true;
    }
    const type = modalTypeOf(cur.kind);
    if (k === 'a' && type !== 'report' && type !== 'chat') { if (ready) dispatch(cur); else onDecide({ item: cur, verdict: 'accept' }); return true; }
    if (k === 'r' && !ready && type !== 'report' && type !== 'chat') { setArmed(cur.id); return true; }
    if (k === 'd' && (type === 'report' || type === 'chat')) { onDecide({ item: cur, verdict: 'done' }); return true; }
    return false;
  }, { enabled: active, priority: OVERLAY_DISMISS_PRIORITY });

  return (
    <motion.div
      ref={ref}
      className="p3-peek p3-root"
      initial={reduced ? { opacity: 0 } : { opacity: 0, scaleY: 0.6, y: -8 }}
      animate={{ opacity: 1, scaleY: 1, y: 0 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, scaleY: 0.8, y: -6 }}
      transition={{ duration: DUR.fast, ease: EASE }}
      data-testid="p3-peek"
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <Icon className="h-4 w-4 text-primary" aria-hidden />
        <span className="typo-heading text-foreground">{meta.label}</span>
        <span className="typo-data tabular-nums text-foreground">{items.length}</span>
        <span className="typo-caption">{ready ? '· accepted, not started' : '· most urgent first'}</span>
        <span className="ml-auto">
          {ready ? (
            <Button variant="accent" tone="success" size="xs" className="whitespace-nowrap" disabled={items.length === 0}
              onClick={() => items.forEach(dispatch)}>
              Dispatch all
            </Button>
          ) : (
            <Button variant="secondary" size="xs" disabled={items.length === 0} onClick={() => onOpen(0)}>
              Open desk
            </Button>
          )}
        </span>
      </div>
      <div className="flex max-h-[360px] flex-col gap-0.5 overflow-y-auto p-1.5" role="listbox" aria-label={meta.label}
        aria-activedescendant={cur ? `p3-peek-row-${cur.id}` : undefined}>
        <AnimatePresence initial={!reduced}>
          {items.map((item, i) => (
            <PeekRow key={item.id} item={item} index={i} focused={i === focus} armed={armed === item.id} ready={ready}
              reduced={reduced} onFocus={setFocus} onOpen={onOpen} onDispatch={dispatch} />
          ))}
        </AnimatePresence>
        {items.length === 0 && <p className="typo-caption px-3 py-4">Nothing waiting here.</p>}
      </div>
      <div className="border-t border-border px-3 py-2">
        <KeyLegend hints={ready
          ? [{ keys: ['↑', '↓'], label: 'move' }, { keys: ['↵'], label: 'dispatch' }, { keys: ['←', '→'], label: 'next chip' }, { keys: ['Esc'], label: 'close' }]
          : [{ keys: ['↑', '↓'], label: 'move' }, { keys: ['A'], label: 'accept' }, { keys: ['R'], label: 'reject' }, { keys: ['↵'], label: 'open' }, { keys: ['←', '→'], label: 'chip' }, { keys: ['Esc'], label: 'close' }]}
        />
      </div>
    </motion.div>
  );
}
