import { useEffect, useLayoutEffect, useState, type RefObject } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { LETTERING } from './draftingModel';

const CALLOUT_MS = 4200;

// Athena's pen (contest A/3): the nib sits at the top-right of whatever she is
// working on (the region in the drawing, else the goal in the title block) and
// glides there when the work moves. Each new action writes a callout beside it
// on a leader line, which fades after a few seconds. Lifted, and dimmed, when
// she is not working.
export default function DraftingPen({
  rootRef,
  target,
  working,
  callout,
}: {
  rootRef: RefObject<HTMLDivElement | null>;
  /** The element she is working on, or null. */
  target: HTMLElement | null;
  working: boolean;
  /** The newest action: its id (a new id writes a new callout), kind and words. */
  callout: { id: string; kind: string; text: string } | null;
}) {
  const { shouldAnimate } = useMotion();
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const [shown, setShown] = useState<string | null>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || !target) {
      setAt(null);
      return;
    }
    const place = () => {
      const r = root.getBoundingClientRect();
      const t = target.getBoundingClientRect();
      setAt({ x: t.right - r.left - 14, y: t.top - r.top + Math.min(14, t.height / 2) });
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(root);
    ro.observe(target);
    return () => ro.disconnect();
  }, [rootRef, target]);

  useEffect(() => {
    if (!callout || !working) return;
    setShown(callout.id);
    const timer = window.setTimeout(() => setShown(null), CALLOUT_MS);
    return () => window.clearTimeout(timer);
  }, [callout, working]);

  if (!at) return null;
  const glide = shouldAnimate ? { type: 'tween' as const, duration: 0.9, ease: [0.3, 0.7, 0.2, 1] as const } : { duration: 0 };
  const showCallout = !!callout && shown === callout.id && working;
  // The callout sits down-left of the nib, clear of what she is drawing, or
  // up-left when the nib is near the bottom of the sheet.
  const height = rootRef.current?.clientHeight ?? Infinity;
  const cx = Math.max(8, at.x - 330);
  const cy = at.y + 26 + 40 > height ? at.y - 26 - 30 : at.y + 26;

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-10">
      <motion.div className="absolute h-0 w-0" initial={false} animate={{ left: at.x, top: at.y, opacity: working ? 1 : 0.5 }} transition={glide}>
        <motion.i
          className="absolute block"
          style={{
            left: -2,
            top: -30,
            width: 4,
            height: 30,
            background: 'linear-gradient(var(--ink-strong), var(--ink))',
            transformOrigin: '2px 30px',
            borderRadius: '2px 2px 0 0',
          }}
          animate={{ rotate: 28, x: working ? 0 : 6, y: working ? 0 : -14 }}
          transition={{ duration: 0.6 }}
        />
        <span className="drafting-nib absolute block rounded-full" data-working={working} style={{ left: -7, top: -7, width: 14, height: 14 }} />
      </motion.div>
      <AnimatePresence>
        {showCallout && (
          <motion.div
            key={callout.id}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
          >
            <svg className="absolute inset-0 h-full w-full overflow-visible">
              <path d={`M${at.x} ${at.y} L${cx + 314} ${cy + 14} L${cx + 300} ${cy + 14}`} fill="none" stroke="var(--ink)" strokeWidth={1} />
            </svg>
            <div
              className="absolute flex max-w-[300px] items-baseline gap-2 truncate rounded-interactive px-2 py-1"
              style={{ left: cx, top: cy, background: 'color-mix(in srgb, var(--paper) 92%, transparent)', border: '1px solid var(--ink-dim)' }}
            >
              <span style={{ ...LETTERING, color: 'var(--ink)' }}>{callout.kind}</span>
              <span className="truncate typo-body text-foreground">{callout.text}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
