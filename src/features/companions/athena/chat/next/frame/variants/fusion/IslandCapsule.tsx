/**
 * Fusion · the island at rest (R5 · A's capsule, copied and adapted): her
 * mark, ONE label, the human gate and the key that opens her. Everything is a
 * label, never a cut sentence ("Running Bash", "Working on 5", the thread's
 * own name). Her last words sit behind it as a tooltip in plain text.
 *
 * Typing while the capsule holds focus opens the conversation with that
 * character already in the composer: the capsule IS the input's first key.
 *
 * `IslandMark` is her real portrait cropped to the face inside a ring that is
 * the island's one live signal: lit and sweeping only while she works (gated
 * on reduced motion), with a warm notch when something waits on you.
 *
 * TODO(prototype, 2026-10-07): athena chat fusion - consolidate after the owner picks.
 */

import { forwardRef, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Hand } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { FUSION_COPY as F } from './copy';
import { EASE } from './text';

export interface CapsuleRead {
  label: string;
  /** She is mid-turn: the mark's ring sweeps. */
  working: boolean;
  /** Items blocked on the operator. */
  gated: number;
  /** Her latest reply as plain text, for the tooltip. */
  lastWords: string | null;
}

export function IslandMark({ working, gated, large = false }: { working: boolean; gated: boolean; large?: boolean }) {
  const { shouldAnimate } = useMotion();
  return (
    <motion.span
      layoutId="fu-mark"
      transition={{ duration: shouldAnimate ? 0.4 : 0, ease: EASE }}
      className={`fu-mark${large ? ' is-lg' : ''}${working ? ' is-live' : ''}${working && shouldAnimate ? ' is-moving' : ''}`}
      aria-hidden
    >
      <span className="fu-ring" />
      <span className="fu-face" />
      {gated && <span className="fu-notch" />}
    </motion.span>
  );
}

/** True while the label is cut by its width: the full words then ride in the tooltip. */
function useTruncated(ref: RefObject<HTMLElement | null>, text: string) {
  const [cut, setCut] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setCut(el.scrollWidth > el.clientWidth + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, text]);
  return cut;
}

export const IslandCapsule = forwardRef<
  HTMLButtonElement,
  { read: CapsuleRead; onOpen: (seed?: string) => void; onOpenGate: () => void }
>(function IslandCapsule({ read, onOpen, onOpenGate }, ref) {
  const { shouldAnimate } = useMotion();
  const labelRef = useRef<HTMLSpanElement>(null);
  const cut = useTruncated(labelRef, read.label);
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey || e.key === ' ') return;
    e.preventDefault();
    onOpen(e.key);
  };
  const capsule = (
    <Button
      ref={ref}
      variant="ghost"
      className="fu-cap"
      onClick={() => onOpen()}
      onKeyDown={onKeyDown}
      aria-label={`${F.island}: ${read.label}. ${F.openChat}`}
      aria-keyshortcuts="Alt+C"
      data-testid="companion-fusion-island"
    >
      <IslandMark working={read.working} gated={read.gated > 0} />
      <span ref={labelRef} className={`typo-title fu-cap-label${read.working ? '' : ' text-foreground'}`}>
        {read.label}
      </span>
    </Button>
  );
  const tip =
    cut || read.lastWords ? (
      <span className="block max-w-[52ch]">
        {cut && <span className="typo-title block text-foreground">{read.label}</span>}
        {read.lastWords && <span className="typo-body block">{read.lastWords}</span>}
      </span>
    ) : null;
  return (
    <span className="fu-cap-row">
      {tip ? (
        <Tooltip content={tip} placement="top" delay={400}>
          {capsule}
        </Tooltip>
      ) : (
        capsule
      )}
      <AnimatePresence initial={false}>
        {read.gated > 0 && (
          <motion.span
            key="gate"
            className="fu-gate-wrap"
            initial={{ opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: 'auto' }}
            exit={{ opacity: 0, width: 0 }}
            transition={{ duration: shouldAnimate ? 0.18 : 0, ease: EASE }}
          >
            <Button
              variant="ghost"
              className="fu-gate"
              onClick={onOpenGate}
              aria-label={`${F.gate(read.gated)}, ${F.keyWork}`}
              aria-keyshortcuts="Alt+W"
              data-testid="companion-fusion-island-gate"
            >
              <Hand aria-hidden />
              <span className="typo-data">{read.gated}</span>
            </Button>
          </motion.span>
        )}
      </AnimatePresence>
      <span className="fu-kbd typo-caption" aria-hidden>
        {F.keyChat}
      </span>
    </span>
  );
});
