/**
 * DecisionPrototypeLab — dev-only switcher for the Decision Center prototype
 * round: direction (p1/p2/p3) x entry point (strip / peek <chip> / modal <type>),
 * on the fixture roster.
 *
 * Mounted two ways:
 *  - in the app, from a dev-only button on the Activity CommandBar (inside a
 *    FullScreenOverlay);
 *  - in the page harness as module `decision-center/prototype`, where the
 *    `?kit=<direction>:<level>[:<chip|type>]` query param picks the entry
 *    (e.g. `?kit=p2:modal:report`) so screenshots are reproducible.
 *
 * Not product UI: copy here is prototype chrome and stays English. It is
 * deleted by the consolidation package together with the losing directions.
 */
import { Suspense, useCallback, useMemo, useState } from 'react';
import { lazyRetry } from '@/lib/lazyRetry';
import { SegmentedTabs, segmentedTabPanelProps } from '@/features/shared/components/layout/SegmentedTabs';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { Button } from '@/features/shared/components/buttons';
import { DECISION_CHIPS, type DecisionItem, type HubChip } from '../model/decisionModel';
import type { DirectionId, HubInitial, PrototypeDirection, PrototypeVerdict } from './directionContract';
import { FIXTURE_ITEMS, FIXTURE_READY, fixtureCounts } from './fixtures';
import { compareDecision } from '../model/decisionOrder';

/** The contract hands directions a roster in `compareDecision` order. */
const SORTED_FIXTURES = [...FIXTURE_ITEMS].sort(compareDecision);

const DIRECTIONS: Record<DirectionId, () => Promise<{ default: PrototypeDirection }>> = {
  p1: () => import('./directions/p1'),
  p2: () => import('./directions/p2'),
  p3: () => import('./directions/p3'),
  r2a: () => import('./directions/r2a'),
  r2b: () => import('./directions/r2b'),
  r2c: () => import('./directions/r2c'),
};

const LAZY: Record<DirectionId, React.FC<import('./directionContract').HubProps>> = {
  p1: lazyRetry(() => DIRECTIONS.p1().then((m) => ({ default: m.default.Hub }))),
  p2: lazyRetry(() => DIRECTIONS.p2().then((m) => ({ default: m.default.Hub }))),
  p3: lazyRetry(() => DIRECTIONS.p3().then((m) => ({ default: m.default.Hub }))),
  r2a: lazyRetry(() => DIRECTIONS.r2a().then((m) => ({ default: m.default.Hub }))),
  r2b: lazyRetry(() => DIRECTIONS.r2b().then((m) => ({ default: m.default.Hub }))),
  r2c: lazyRetry(() => DIRECTIONS.r2c().then((m) => ({ default: m.default.Hub }))),
};

type Entry = 'strip' | `peek:${HubChip}` | 'modal:backlog' | 'modal:approval' | 'modal:report' | 'modal:chat';

const ENTRIES: Entry[] = [
  'strip',
  ...DECISION_CHIPS.map((c) => `peek:${c}` as Entry),
  'peek:ready',
  'modal:backlog',
  'modal:approval',
  'modal:report',
  'modal:chat',
];

function toInitial(entry: Entry): HubInitial {
  if (entry === 'strip') return { level: 'strip' };
  const [level, arg] = entry.split(':') as ['peek' | 'modal', string];
  if (level === 'peek') return { level: 'peek', chip: arg as HubChip };
  return { level: 'modal', type: arg as 'backlog' | 'approval' | 'report' | 'chat' };
}

function levelOf(entry: Entry): 'strip' | 'peek' | 'modal' {
  return entry === 'strip' ? 'strip' : (entry.split(':')[0] as 'peek' | 'modal');
}

function readKit(): { direction: DirectionId; entry: Entry } {
  const fallback = { direction: 'p1' as DirectionId, entry: 'strip' as Entry };
  if (typeof window === 'undefined') return fallback;
  const kit = new URLSearchParams(window.location.search).get('kit');
  if (!kit) return fallback;
  const [d, ...rest] = kit.split(':');
  const direction = (['p1', 'p2', 'p3', 'r2a', 'r2b', 'r2c'] as const).includes(d as DirectionId) ? (d as DirectionId) : 'p1';
  const entry = rest.join(':') as Entry;
  return { direction, entry: ENTRIES.includes(entry) ? entry : 'strip' };
}

export default function DecisionPrototypeLab() {
  const initial = useMemo(readKit, []);
  const [direction, setDirection] = useState<DirectionId>(initial.direction);
  const [entry, setEntry] = useState<Entry>(initial.entry);
  const [items, setItems] = useState<DecisionItem[]>(SORTED_FIXTURES);
  const [ready, setReady] = useState<DecisionItem[]>(FIXTURE_READY);
  const [failChip, setFailChip] = useState(false);
  const [run, setRun] = useState(0);

  const counts = useMemo(() => {
    const c = fixtureCounts(items, ready);
    if (failChip) c.council = { n: 0, lamp: 'danger', failed: true };
    return c;
  }, [items, ready, failChip]);

  const onDecide = useCallback((v: PrototypeVerdict) => {
    if (v.verdict === 'skip') return;
    setItems((xs) => xs.filter((x) => x.id !== v.item.id));
    setReady((xs) => xs.filter((x) => x.id !== v.item.id));
  }, []);

  const pick = (e: Entry) => {
    setEntry(e);
    setRun((r) => r + 1);
  };

  const reset = () => {
    setItems(SORTED_FIXTURES);
    setReady(FIXTURE_READY);
    setRun((r) => r + 1);
  };

  const Hub = LAZY[direction];
  return (
    <div className="flex h-full min-h-0 flex-col bg-background" data-testid="decision-prototype-lab">
      <div className="flex flex-wrap items-center gap-3 border-b border-primary/10 px-4 py-2">
        <SegmentedTabs
          tabs={(['p1', 'p2', 'p3', 'r2a', 'r2b', 'r2c'] as const).map((id) => ({ id, label: id.toUpperCase() }))}
          activeTab={direction}
          onTabChange={(d) => setDirection(d)}
          size="sm"
          ariaLabel="Direction"
          idPrefix="dlab-dir"
          layoutId="decision-lab-direction"
        />
        <SegmentedTabs
          tabs={(['strip', 'peek', 'modal'] as const).map((id) => ({ id, label: id }))}
          activeTab={levelOf(entry)}
          onTabChange={(l) => pick(l === 'strip' ? 'strip' : l === 'peek' ? 'peek:gates' : 'modal:approval')}
          size="sm"
          ariaLabel="Level"
          idPrefix="dlab-level"
          layoutId="decision-lab-level"
        />
        {levelOf(entry) !== 'strip' && (
          <SegmentedTabs
            tabs={ENTRIES.filter((e) => e.startsWith(`${levelOf(entry)}:`)).map((e) => ({ id: e, label: e.split(':')[1]! }))}
            activeTab={entry}
            onTabChange={pick}
            size="sm"
            ariaLabel="Target"
            idPrefix="dlab-target"
            layoutId="decision-lab-target"
          />
        )}
        <AccessibleToggle checked={failChip} onChange={() => setFailChip((f) => !f)} label="council source failed" size="sm" />
        <Button variant="ghost" size="sm" onClick={reset}>
          {'reset roster'}
        </Button>
      </div>
      <div {...segmentedTabPanelProps('dlab-dir', direction)} role="tabpanel" className="relative min-h-0 flex-1">
        <div {...segmentedTabPanelProps('dlab-level', levelOf(entry))} role="tabpanel" className="h-full">
        <div {...(levelOf(entry) === 'strip' ? {} : segmentedTabPanelProps('dlab-target', entry))} role={levelOf(entry) === 'strip' ? undefined : 'tabpanel'} className="h-full">
        <Suspense fallback={null}>
          <Hub
            key={`${direction}:${entry}:${run}`}
            items={items}
            counts={counts}
            ready={ready}
            initial={toInitial(entry)}
            onDecide={onDecide}
          />
        </Suspense>
        </div>
        </div>
      </div>
    </div>
  );
}
