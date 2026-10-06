/**
 * R2-A hub — strip -> peek -> deck, and the Esc ladder back down
 * (deck -> the peek it came from -> strip).
 */
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { chipOf, modalTypeOf, type DecisionItem, type HubChip } from '../../../model/decisionModel';
import type { HubProps } from '../../directionContract';
import { CHIP_META } from './deckMeta';
import { originFrom } from './deckMotion';
import { DeckModal, type DeckSession } from './DeckModal';
import { FleetFloor } from './FleetFloor';
import { Peek, type PeekVerdict } from './Peek';
import { Strip } from './Strip';
import { queueOf, type DeckScope } from './useDeck';

const TYPE_LABEL = { approval: 'Approvals', backlog: 'Backlog', report: 'Reading', chat: 'Chat' } as const;

function scopeLabel(scope: DeckScope): string {
  if (scope.kind === 'all') return 'Triage all';
  if (scope.kind === 'type') return TYPE_LABEL[scope.type];
  return CHIP_META[scope.chip].label;
}

function kit(): string {
  if (typeof window === 'undefined') return '';
  return new URLSearchParams(window.location.search).get('kit') ?? '';
}

/** Harness-only deep link: `?kit=r2a:modal:<type>:<sourceId>` opens that card (the Lab only knows `modal:<type>`). */
function kitItem(): string | null {
  const m = /^r2a:modal:\w+:(\w+)$/.exec(kit());
  return m ? m[1]! : null;
}

/** Harness-only: `?kit=r2a:strip-states` — council's source failed and Ready is at zero, in one shot. */
const STATES_KIT = 'r2a:strip-states';

export function Hub({ items, counts: liveCounts, ready: liveReady, initial, onDecide }: HubProps) {
  const chipRefs = useRef<Partial<Record<HubChip | 'all', HTMLButtonElement | null>>>({});
  const anchor = useRef<HTMLElement | null>(null);
  const [peek, setPeek] = useState<{ chip: HubChip } | null>(null);
  const [session, setSession] = useState<DeckSession | null>(null);
  const back = useRef<HubChip | null>(null);
  const opened = useRef(0);
  const states = useMemo(() => kit() === STATES_KIT, []);
  const ready = states ? [] : liveReady;
  const counts = useMemo(() => (states
    ? { ...liveCounts, council: { n: 0, lamp: 'danger' as const, failed: true }, ready: { n: 0, lamp: 'neutral' as const, failed: false } }
    : liveCounts), [states, liveCounts]);

  const openPeek = useCallback((chip: HubChip, toggle = true) => {
    anchor.current = chipRefs.current[chip] ?? null;
    setPeek((p) => (toggle && p?.chip === chip ? null : { chip }));
  }, []);

  const openDeck = useCallback((scope: DeckScope, startId: string, from: Element | null, returnTo: HubChip | null) => {
    back.current = returnTo;
    setPeek(null);
    setSession({ key: ++opened.current, scope, scopeLabel: scopeLabel(scope), startId, origin: originFrom(from) });
  }, []);

  const stepBack = useCallback(() => {
    setSession(null);
    if (back.current) openPeek(back.current, false);
  }, [openPeek]);

  // Entry points from the Lab (and the harness deep link for a specific card).
  useLayoutEffect(() => {
    const deep = initial.level === 'strip' ? kitItem() : null;
    const target = deep ? items.find((x) => x.sourceId === deep) : null;
    if (target) {
      const type = modalTypeOf(target.kind);
      openDeck({ kind: 'type', type }, target.id, chipRefs.current[chipOf(target.kind)] ?? null, chipOf(target.kind));
    } else if (initial.level === 'peek') {
      openPeek(initial.chip, false);
    } else if (initial.level === 'modal') {
      const first = queueOf({ kind: 'type', type: initial.type }, items, ready)[0];
      if (first) openDeck({ kind: 'type', type: initial.type }, first.id, chipRefs.current[chipOf(first.kind)] ?? null, chipOf(first.kind));
    }
    // Entry is read once per mount; the Lab remounts the hub to change it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const peekRows = peek ? queueOf({ kind: 'chip', chip: peek.chip }, items, ready) : [];
  const verdict = (item: DecisionItem, v: PeekVerdict) => onDecide({ item, verdict: v });

  return (
    <div className="r2a relative flex h-full min-h-0 flex-col bg-background" data-testid="r2a-hub">
      <div className="relative z-20">
        <Strip
          counts={counts}
          items={items}
          openChip={peek?.chip ?? null}
          chipRefs={chipRefs}
          onChip={openPeek}
          onTriageAll={() => items[0] && openDeck({ kind: 'all' }, items[0].id, chipRefs.current.all ?? null, null)}
        />
        <AnimatePresence>
          {peek && (
            <Peek
              key={peek.chip}
              chip={peek.chip}
              rows={peekRows}
              failed={counts[peek.chip].failed}
              nextId={items[0]?.id ?? null}
              active={!session}
              anchor={anchor}
              onOpen={(item, from) => openDeck({ kind: 'chip', chip: peek.chip }, item.id, from, peek.chip)}
              onVerdict={verdict}
              onDispatchAll={() => ready.forEach((item) => onDecide({ item, verdict: 'accept' }))}
              onClose={() => setPeek(null)}
            />
          )}
        </AnimatePresence>
      </div>
      <FleetFloor />
      <DeckModal session={session} items={items} ready={ready} onDecide={onDecide} onBack={stepBack} />
    </div>
  );
}
