import { useLayoutEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { LETTERING, regionWeights } from './draftingModel';

export type RegionState = 'pending' | 'drafting' | 'done';

export interface DraftingRegion {
  title: string;
  purpose?: string;
  state: RegionState;
}

const DESKTOP = 1280;

// One page of the drawing (contest A/3): a numbered caption, a width dimension,
// and the page's regions stacked top to bottom. A pending region is a dashed
// outline; where Athena works the region is inked and hatched under her pen; a
// done region is inked with a tick. When the live page exists it shows through
// as a cyanotype proof that develops into colour as the plan gets done, and
// the regions become a numbered legend over it.
export default function DraftingPage({
  num,
  title,
  route,
  regions,
  stateWords,
  proof,
  compact = false,
  draftingRef,
  delay = 0,
}: {
  num: number;
  title: string;
  route?: string;
  regions: DraftingRegion[];
  stateWords: Record<RegionState, string>;
  /** The live page to develop behind the drawing, and how far along it is. */
  proof?: { url: string; filter: string } | null;
  compact?: boolean;
  /** Receives the region Athena is drafting now, for the pen. */
  draftingRef?: (el: HTMLElement | null) => void;
  delay?: number;
}) {
  const { shouldAnimate } = useMotion();
  const boxRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el || !proof) return;
    const measure = () => setScale(el.clientWidth / DESKTOP);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [proof]);
  const weights = regionWeights(regions.map((r) => r.title));
  const draw = (i: number) =>
    shouldAnimate
      ? {
          initial: { clipPath: 'inset(0 100% 100% 0)' },
          animate: { clipPath: 'inset(0 0% 0% 0)' },
          transition: { duration: 0.9, delay: delay + 0.14 * i, ease: 'easeOut' as const },
        }
      : {};

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p className="mb-2 flex items-baseline gap-2.5">
        <span
          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
          style={{ ...LETTERING, letterSpacing: 0, background: 'var(--ink)', color: 'var(--paper)' }}
        >
          {num}
        </span>
        <span style={{ ...LETTERING, color: 'var(--ink-strong)' }}>{title}</span>
        {route && <span className="typo-code text-foreground/90">{route}</span>}
      </p>
      {!compact && (
        <div className="relative mb-2 h-3" aria-hidden>
          <div className="absolute inset-x-0 top-1.5 h-px" style={{ background: 'var(--ink-faint)' }} />
          <div className="absolute left-0 top-0 h-3 w-px" style={{ background: 'var(--ink-dim)' }} />
          <div className="absolute right-0 top-0 h-3 w-px" style={{ background: 'var(--ink-dim)' }} />
          <span className="absolute left-1/2 top-0 -translate-x-1/2 px-1 typo-code leading-3" style={{ background: 'var(--paper)', color: 'var(--ink-dim)' }}>
            {DESKTOP}
          </span>
        </div>
      )}
      <div
        ref={boxRef}
        className="relative min-h-0 flex-1 overflow-hidden rounded-interactive"
        style={{ border: proof ? '1px solid var(--ink)' : undefined }}
      >
        {proof && scale > 0 && (
          <motion.iframe
            key={proof.url}
            src={proof.url}
            title={title}
            aria-hidden
            tabIndex={-1}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.7 }}
            className="pointer-events-none absolute left-0 top-0 origin-top-left border-0"
            style={{
              width: DESKTOP,
              height: `${100 / scale}%`,
              transform: `scale(${scale})`,
              filter: proof.filter,
              transition: 'filter 2400ms ease-out',
            }}
          />
        )}
        {proof ? (
          // The regions as a legend along the bottom edge, clear of the page's own top.
          <ol className="absolute inset-x-2 bottom-2 flex flex-wrap gap-1">
            {regions.map((r, i) => (
              <li
                key={`${i}-${r.title}`}
                ref={r.state === 'drafting' ? draftingRef : undefined}
                className="flex items-baseline gap-2 rounded-interactive px-1.5 py-0.5"
                style={{ background: 'color-mix(in srgb, var(--paper) 88%, transparent)', border: `1px ${r.state === 'pending' ? 'dashed' : 'solid'} var(--ink-dim)` }}
              >
                <span style={{ ...LETTERING, color: 'var(--ink-strong)' }}>{`${i + 1} ${r.title}`}</span>
                {r.state !== 'pending' && <span className="typo-caption">{stateWords[r.state]}</span>}
              </li>
            ))}
          </ol>
        ) : (
          <div className="flex h-full flex-col gap-2">
            {regions.map((r, i) => (
              <motion.div
                key={`${i}-${r.title}`}
                {...draw(i)}
                ref={r.state === 'drafting' ? draftingRef : undefined}
                className="relative min-h-0 overflow-hidden rounded-interactive"
                style={{
                  flexGrow: weights[i],
                  flexBasis: 0,
                  border: `1px ${r.state === 'pending' ? 'dashed' : 'solid'} ${r.state === 'drafting' ? 'var(--ink-strong)' : r.state === 'done' ? 'var(--ink)' : 'var(--ink-dim)'}`,
                  boxShadow: r.state === 'drafting' ? '0 0 0 1px var(--ink-faint), 0 0 24px color-mix(in srgb, var(--primary) 18%, transparent)' : undefined,
                }}
              >
                {r.state === 'drafting' && <div aria-hidden className="drafting-hatch pointer-events-none absolute inset-0" />}
                <div className="relative flex items-baseline gap-2 px-2 pt-1.5">
                  <span style={{ ...LETTERING, color: 'var(--ink-strong)' }}>{r.title}</span>
                  {r.state !== 'pending' && <span className="typo-caption">{stateWords[r.state]}</span>}
                </div>
                {!compact && r.purpose && <p className="relative truncate px-2 typo-caption">{r.purpose}</p>}
                {r.state === 'done' && <Ticks />}
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** The mark a finished region carries. */
function Ticks() {
  return (
    <motion.i
      aria-hidden
      initial={{ opacity: 0, scale: 2, rotate: 45 }}
      animate={{ opacity: 0.9, scale: 1, rotate: 45 }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
      className="absolute bottom-2 right-3 block h-2.5 w-1.5"
      style={{ borderRight: '1.5px solid var(--ink)', borderBottom: '1.5px solid var(--ink)' }}
    />
  );
}
