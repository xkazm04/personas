/**
 * Level 2 — the peek: an anchored drop under its chip listing that chip's
 * items in roster order. Light to open, light to dismiss (Esc, click outside,
 * the chip again). ↑/↓ move, Enter opens the deck on the focused row, A / R /
 * D decide it in place and the row slides out toward its verdict.
 */
import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, Rocket } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { Kbd } from '@/features/shared/triage/triageFocusBridge';
import { useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import { useClickOutside } from '@/hooks/utility/interaction/useClickOutside';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { modalTypeOf, type DecisionItem, type HubChip } from '../../../model/decisionModel';
import { CHIP_META } from './deckMeta';
import { PEEK_PRIORITY, isTypingTarget, plain } from './keys';
import { PeekRow } from './PeekRow';

export type PeekVerdict = 'accept' | 'reject' | 'done';

const reads = (item: DecisionItem) => modalTypeOf(item.kind) === 'report' || modalTypeOf(item.kind) === 'chat';

export function Peek({ chip, rows, failed, nextId, active, anchor, onOpen, onVerdict, onDispatchAll, onClose }: {
  chip: HubChip;
  rows: DecisionItem[];
  failed: boolean;
  nextId: string | null;
  active: boolean;
  anchor: RefObject<HTMLElement | null>;
  onOpen: (item: DecisionItem, from: Element | null) => void;
  onVerdict: (item: DecisionItem, verdict: PeekVerdict) => void;
  onDispatchAll: () => void;
  onClose: () => void;
}) {
  const still = useReducedMotion();
  const panel = useRef<HTMLDivElement>(null);
  const rowEls = useRef<Record<string, HTMLDivElement | null>>({});
  const [focus, setFocus] = useState(0);
  const [leaveDir, setLeaveDir] = useState(1);
  const f = Math.min(focus, Math.max(0, rows.length - 1));
  const meta = CHIP_META[chip];
  const isReady = chip === 'ready';
  const [left, setLeft] = useState(8);
  useClickOutside([panel, anchor], active, onClose);

  // Anchored under the chip, and kept there when the strip re-flows (labels <-> compact).
  useLayoutEffect(() => {
    const a = anchor.current;
    const box = panel.current?.offsetParent;
    if (!a || !(box instanceof HTMLElement)) return;
    const place = () => {
      const l = a.getBoundingClientRect().left - box.getBoundingClientRect().left;
      setLeft(Math.max(8, Math.min(l, box.clientWidth - (panel.current?.offsetWidth ?? 480) - 8)));
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(a);
    ro.observe(box);
    return () => ro.disconnect();
  }, [anchor]);

  const verdict = (item: DecisionItem, v: PeekVerdict) => {
    // Council verdicts are two-step (arm + confirm, or a written reason): the deck owns that.
    if (item.kind === 'council') { onOpen(item, rowEls.current[item.id] ?? null); return; }
    setLeaveDir(v === 'reject' ? -1 : 1);
    onVerdict(item, v);
  };

  useAppKeyboard((e) => {
    if (e.key === 'Escape') { onClose(); return true; }
    if (isTypingTarget(e.target) || !plain(e) || rows.length === 0) return false;
    const item = rows[f]!;
    const isRead = reads(item);
    switch (e.key) {
      case 'ArrowDown': case 'j': setFocus(Math.min(rows.length - 1, f + 1)); break;
      case 'ArrowUp': case 'k': setFocus(Math.max(0, f - 1)); break;
      case 'Enter': onOpen(item, rowEls.current[item.id] ?? null); break;
      case 'a': case 'A': if (isReady || !isRead) verdict(item, 'accept'); else return false; break;
      case 'r': case 'R': if (!isReady && !isRead) verdict(item, 'reject'); else return false; break;
      case 'd': case 'D': if (isRead) verdict(item, 'done'); else return false; break;
      default: return false;
    }
    e.preventDefault();
    return true;
  }, { enabled: active, priority: PEEK_PRIORITY });

  return (
    <motion.div
      ref={panel}
      role="region"
      aria-label={`${meta.label} — ${rows.length} waiting`}
      initial={still ? { opacity: 0 } : { opacity: 0, y: -8, scaleY: 0.94 }}
      animate={{ opacity: 1, y: 0, scaleY: 1 }}
      exit={still ? { opacity: 0 } : { opacity: 0, y: -6, scaleY: 0.96 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      style={{ left, transformOrigin: 'top left' }}
      className="absolute top-full z-30 mt-1.5 flex w-[480px] max-w-[calc(100%-16px)] flex-col rounded-card border border-primary/20 bg-background shadow-elevation-3"
      data-testid="p2-peek"
    >
      <header className="flex items-center gap-2 border-b border-primary/10 px-4 py-2.5">
        <meta.icon className="h-4 w-4 text-primary" aria-hidden />
        <span className="typo-heading text-foreground">{meta.label}</span>
        <span className="typo-caption">{rows.length} waiting</span>
        <span className="ml-auto flex items-center gap-1.5">
          {isReady ? (
            <Button variant="accent" tone="success" size="xs" onClick={onDispatchAll} disabled={rows.length === 0} icon={<Rocket className="h-3.5 w-3.5" aria-hidden />}>
              Dispatch all
            </Button>
          ) : rows.length > 0 && (
            <Button variant="ghost" size="xs" className="whitespace-nowrap" onClick={() => onOpen(rows[f]!, rowEls.current[rows[f]!.id] ?? null)} iconRight={<ArrowRight className="h-3.5 w-3.5" aria-hidden />}>
              Open deck
            </Button>
          )}
        </span>
      </header>
      <div className="flex max-h-[420px] flex-col gap-1 overflow-y-auto p-2">
        <AnimatePresence initial={!still} custom={leaveDir}>
          {rows.map((item, i) => (
            <PeekRow
              key={item.id}
              ref={(el) => { rowEls.current[item.id] = el; }}
              item={item}
              index={i}
              focused={i === f}
              isNext={item.id === nextId}
              isReady={isReady}
              leaveDir={leaveDir}
              onFocus={() => setFocus(i)}
              onOpen={() => onOpen(item, rowEls.current[item.id] ?? null)}
              onDispatch={() => { setLeaveDir(1); onVerdict(item, 'accept'); }}
            />
          ))}
        </AnimatePresence>
        {failed && <p className="px-3 py-2 typo-body text-status-error">This source did not answer — the list may be incomplete.</p>}
        {rows.length === 0 && !failed && <p className="px-3 py-6 text-center typo-caption">All clear here.</p>}
      </div>
      <footer className="flex items-center gap-1.5 border-t border-primary/10 px-4 py-2 typo-caption">
        <Kbd>↑</Kbd><Kbd>↓</Kbd> move <Kbd>↵</Kbd> open
        {isReady ? <><Kbd>A</Kbd> dispatch</> : (
          <>
            {rows.some((r) => !reads(r)) && <><Kbd>A</Kbd> approve <Kbd>R</Kbd> reject</>}
            {rows.some(reads) && <><Kbd>D</Kbd> done</>}
          </>
        )}
        <span className="ml-auto flex items-center gap-1.5"><Kbd>Esc</Kbd> close</span>
      </footer>
    </motion.div>
  );
}
