import { useEffect, useRef, useState, type ReactNode } from 'react';
import { animate, motion } from 'framer-motion';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { Press } from '../Press';

export type RailTone = 'amber' | 'red' | 'mint' | 'ink';

export interface RailEntry {
  k: string;
  label: string;
  /** The tooltip, and the item's accessible name with its figures. */
  title: string;
  glyph: ReactNode;
  /** The main figure: a number counts to its new value; text shows as is; null shows the key instead. */
  n: number | string | null;
  /** A small red figure on the glyph (an urgent count), shown when above 0. */
  n2?: number;
  n2title?: string;
  tone: RailTone;
  sub?: string;
  /** The key that opens it, printed as a keycap when there is no figure. */
  kbd?: string;
  on?: boolean;
  disabled?: boolean;
  onPress?: () => void;
}

/** A number that counts to its new value (bp Dock Count); instant under reduced motion. */
function Count({ n }: { n: number }) {
  const reduce = useReducedMotion();
  const [d, setD] = useState(n);
  const cur = useRef(n);
  useEffect(() => {
    if (cur.current === n) return;
    if (reduce) { cur.current = n; setD(n); return; }
    const from = cur.current;
    const c = animate(from, n, { duration: Math.min(0.7, 0.2 + Math.abs(n - from) * 0.06), ease: 'easeOut', onUpdate: (v) => { cur.current = Math.round(v); setD(cur.current); } });
    return () => c.stop();
  }, [n, reduce]);
  return <>{d}</>;
}

/**
 * One rail item (bp Dock RailItem): a 22 px glyph, a 15 px mono tabular figure, a 12 px mono uppercase label and an
 * optional sub-label, in its tone. When the main figure moves, one pulse outline, at most every 3 s and never under
 * reduced motion.
 */
export function RailItem({ it }: { it: RailEntry }) {
  const reduce = useReducedMotion();
  const [pulse, setPulse] = useState(0);
  const last = useRef(it.n), lastAt = useRef(0);
  useEffect(() => {
    if (last.current === it.n) return;
    last.current = it.n;
    const now = performance.now();
    if (reduce || now - lastAt.current < 3000) return;
    lastAt.current = now;
    setPulse((p) => p + 1);
  }, [it.n, reduce]);
  const name = it.label + (it.n !== null ? ': ' + it.n : '') + (it.sub ? ' ' + it.sub : '') + (it.n2 ? ', ' + (it.n2title ?? it.n2) : '');
  return (
    <Tooltip content={it.title} placement="left">
      <Press tone={`ri t-${it.tone}`} on={it.on} disabled={it.disabled} onClick={it.onPress} aria-label={name} data-k={it.k}>
        {pulse > 0 && <motion.span key={pulse} className="pl" aria-hidden="true" initial={{ opacity: 0.55, scale: 0.92 }} animate={{ opacity: 0, scale: 1.08 }} transition={{ duration: 0.8, ease: 'easeOut' }} />}
        <span className="g" aria-hidden="true">{it.glyph}{it.n2 ? <b className="n2">{it.n2}</b> : null}</span>
        {it.n !== null ? <span className="n" aria-hidden="true">{typeof it.n === 'number' ? <Count n={it.n} /> : it.n}</span> : <span className="n kb" aria-hidden="true">{it.kbd}</span>}
        <span className="lb" aria-hidden="true">{it.label}</span>
        {it.sub && <span className="sb" aria-hidden="true">{it.sub}</span>}
      </Press>
    </Tooltip>
  );
}
