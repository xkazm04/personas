/**
 * Prototype direction P1 — "Conventional, perfected".
 *
 * ModalShell's lineage taken to Linear/Raycast restraint: a labelled chip
 * strip whose count badges are the severity lamps, a tidy anchored popover
 * list, and one centered sheet family for all four modal types. Excellence
 * through type, spacing and rhythm; motion is short and exact.
 */
import { useLayoutEffect, useRef, useState } from 'react';
import { useClickOutside } from '@/hooks/utility/interaction/useClickOutside';
import { AnimatePresence } from 'framer-motion';
import { chipOf } from '../../../model/decisionModel';
import type { HubProps, PrototypeDirection } from '../../directionContract';
import { DecisionSheet } from './DecisionSheet';
import { Peek } from './Peek';
import { FloorStandIn, Strip } from './Strip';
import { p1Kit, useHub } from './useHub';
import './p1.css';

const PEEK_WIDTH_REM = 30;

/** `p1:strip-states`: council's source failed, chat answered to zero — both states in one shot. */
function withStates(props: HubProps): HubProps {
  if (p1Kit() !== 'p1:strip-states') return props;
  return {
    ...props,
    items: props.items.filter((i) => i.kind !== 'message'),
    counts: { ...props.counts, council: { n: 0, lamp: 'danger', failed: true }, chat: { n: 0, lamp: 'neutral', failed: false } },
  };
}

function Hub(raw: HubProps) {
  const props = withStates(raw);
  const { items, counts, ready, onDecide } = props;
  const hub = useHub(props);
  const { closePeek } = hub;
  const hubRef = useRef<HTMLDivElement>(null);
  const peekRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null);
  const modalOpen = !!hub.modal?.open;

  // Anchor the peek under its chip, clamped inside the hub.
  useLayoutEffect(() => {
    const place = () => {
      const root = hubRef.current;
      const chip = hub.peek && root?.querySelector(`[data-p1-chip="${hub.peek}"]`);
      if (!root || !chip) { setAnchor(null); return; }
      const r = root.getBoundingClientRect();
      const c = chip.getBoundingClientRect();
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const maxLeft = r.width - PEEK_WIDTH_REM * rem - 12;
      setAnchor({ left: Math.max(12, Math.min(c.left - r.left, maxLeft)), top: c.bottom - r.top + 6 });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [hub.peek]);

  // Light to dismiss: a press outside the peek and the strip, or Esc. The strip
  // counts as inside so a chip press toggles/switches instead of closing first.
  // Off while the sheet is up — the sheet owns Esc then, and steps back to here.
  useClickOutside([peekRef, stripRef], !!hub.peek && !modalOpen, closePeek, { claimEscape: true });

  const rows = hub.peek === 'ready' ? ready : hub.peek ? items.filter((i) => chipOf(i.kind) === hub.peek) : [];

  return (
    <div ref={hubRef} className="relative flex h-full min-h-0 flex-col bg-background" data-testid="p1-hub">
      <div ref={stripRef}>
        <Strip items={items} counts={counts} openChip={hub.peek} onToggle={hub.togglePeek} onTriageAll={hub.triageAll} />
      </div>
      <FloorStandIn />
      <div ref={peekRef}>
        <AnimatePresence>
          {hub.peek && anchor && (
            <Peek
              key={hub.peek}
              chip={hub.peek}
              rows={rows}
              count={counts[hub.peek]}
              anchor={anchor}
              keysEnabled={!modalOpen}
              onOpen={hub.openFromPeek}
              onDecide={onDecide}
            />
          )}
        </AnimatePresence>
      </div>
      <DecisionSheet
        open={modalOpen}
        item={hub.current}
        index={hub.index}
        total={hub.queue.length}
        scope={hub.scope}
        origin={hub.modal?.origin ?? null}
        exitOrigin={hub.modal?.exitOrigin ?? null}
        dir={hub.dir}
        leave={hub.leave}
        flash={hub.flash}
        onWalk={hub.walk}
        onClose={hub.close}
        onVerdict={hub.verdict}
      />
    </div>
  );
}

const direction: PrototypeDirection = {
  id: 'p1',
  name: 'P1 · Conventional',
  tagline: 'ModalShell perfected: labelled strip, tidy popover list, one calm centered sheet for all four types.',
  Hub,
};

export default direction;
