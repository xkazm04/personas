/**
 * Prototype direction P3 — "The Desk" (wildcard).
 *
 * The peek never disappears: it DOCKS. Strip chip -> a drawer pulled out of the
 * chip -> Enter flies those same rows to the left edge of a desk, where they
 * stay as the queue while the item is decided beside them. Long reports turn
 * the desk into a reading room (whole window, slim queue, contents, pinned
 * decision footer). Fixture data only; verdicts go to `onDecide`.
 */
import { useCallback, useMemo, useState } from 'react';
import { AnimatePresence, LayoutGroup } from 'framer-motion';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { chipOf, type DecisionChip, type HubChip } from '../../../model/decisionModel';
import type { HubProps, PrototypeDirection } from '../../directionContract';
import { CHIP_META, queueFor } from './model';
import { resolveStart, withDemoStates } from './start';
import { Strip } from './Strip';
import { Peek } from './Peek';
import { Desk } from './Desk';
import { FleetFloor } from './FleetFloor';
import './p3.css';

interface DeskState { scope: DecisionChip | 'all'; index: number; origin: 'peek' | 'strip' }

function Hub(props: HubProps) {
  const reduced = useReducedMotion();
  const [start] = useState(() => resolveStart(props.items, props.initial));
  const { items, counts } = useMemo(
    () => (start.demoStates ? withDemoStates(props.items, props.counts) : { items: props.items, counts: props.counts }),
    [start.demoStates, props.items, props.counts],
  );
  const { ready, onDecide } = props;
  const [peek, setPeek] = useState<HubChip | null>(start.peek);
  const [desk, setDesk] = useState<DeskState | null>(start.desk);

  const closePeek = useCallback(() => setPeek(null), []);
  const openDesk = useCallback((chip: DecisionChip, index: number) => {
    setPeek(null);
    setDesk({ scope: chip, index, origin: 'peek' });
  }, []);
  // Esc ladder: desk -> the peek it was opened from (-> strip on the next Esc).
  const closeDesk = useCallback(() => {
    if (desk && desk.origin === 'peek' && desk.scope !== 'all') setPeek(desk.scope);
    setDesk(null);
  }, [desk]);

  const peekItems = (chip: HubChip) => (chip === 'ready' ? ready : queueFor(items, chip));
  const deskQueue = desk ? queueFor(items, desk.scope) : [];

  return (
    <LayoutGroup id="p3">
      <div className="p3-root flex h-full min-h-0 flex-col bg-background" data-testid="p3-hub">
        <Strip
          items={items}
          counts={counts}
          openChip={peek}
          reduced={reduced}
          onChip={(c) => setPeek((p) => (p === c ? null : c))}
          onTriageAll={() => { setPeek(null); setDesk({ scope: 'all', index: 0, origin: 'strip' }); }}
          onOpenHead={() => {
            const head = items[0];
            if (head) { setPeek(null); setDesk({ scope: chipOf(head.kind), index: 0, origin: 'strip' }); }
          }}
          renderPeek={(chip, anchor) => (
            <AnimatePresence>
              {peek === chip && !desk && (
                <Peek
                  key={chip}
                  chip={chip}
                  anchorRef={anchor}
                  items={peekItems(chip)}
                  reduced={reduced}
                  active={!desk}
                  onClose={closePeek}
                  onOpen={(i) => chip !== 'ready' && openDesk(chip, i)}
                  onSwitch={setPeek}
                  onDecide={onDecide}
                />
              )}
            </AnimatePresence>
          )}
        />
        <FleetFloor />
        {desk && (
          <Desk
            queue={deskQueue}
            startIndex={desk.index}
            scopeLabel={desk.scope === 'all' ? 'Triage all · whole roster' : `${CHIP_META[desk.scope].label} queue`}
            reduced={reduced}
            onClose={closeDesk}
            onDecide={onDecide}
          />
        )}
      </div>
    </LayoutGroup>
  );
}

const direction: PrototypeDirection = {
  id: 'p3',
  name: 'P3 · The Desk',
  tagline: 'The peek never leaves — it docks beside the item; long reports open a reading room.',
  Hub,
};

export default direction;
