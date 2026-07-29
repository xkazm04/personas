/**
 * TriageCockpitVariant — deliberate triage. An air-traffic-control desk for the
 * queue of things waiting on a human.
 *
 * The bet this variant makes: a lot of triage queues are not forty items to be
 * flicked through, they are twelve items that each deserve a minute. So the
 * whole queue is visible at once (left rail), one case is typeset to be
 * genuinely READ (centre), and the decision sits with the facts it depends on
 * (right rail). The keyboard walks the queue WITHOUT deciding — browsing is a
 * first-class act here, which is the sharpest difference from a swipe deck,
 * where moving on IS a verdict.
 *
 * Ownership: this file owns the state machine — cursor, answer draft, local
 * skip memory, decision dispatch — and nothing else. The three panes, the
 * chrome and the key map are dumb modules in `./cockpit/`.
 *
 * Two things worth knowing before editing:
 *  • Visual order IS navigation order. The rail groups by kind, so the cursor
 *    walks the flattened group list, never `queue.items` — otherwise ↓ would
 *    jump between sections.
 *  • `decidingRef` is a per-item in-flight claim. `queue.busyId` is state and
 *    isn't visible until the next commit, so without the ref a double-tap of
 *    `A` would dispatch the same row twice.
 *
 * ⚠️ PROTOTYPE (/prototype round 1, 2026-07-29). English string literals are
 * inline on purpose: another session holds uncommitted work in `src/i18n/**`,
 * so this variant must not touch the locale files. If Cockpit wins, every
 * literal in this file and `triage/cockpit/*` moves to `t.*` at consolidation.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';

import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';

import type { TriageItem, TriageVerdict } from './triageTypes';
import type { UnifiedTriageQueue } from './useUnifiedTriage';
import { CockpitFooter, CockpitHeader } from './cockpit/CockpitChrome';
import { CockpitEmpty, CockpitLoading } from './cockpit/CockpitStates';
import { TriageCasePane } from './cockpit/TriageCasePane';
import { TriageLedgerRail } from './cockpit/TriageLedgerRail';
import { groupQueue, TriageQueueRail } from './cockpit/TriageQueueRail';
import { useCockpitKeyboard } from './cockpit/useCockpitKeyboard';

/** The app's standard ease curve (Design.md §6). */
const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

/** Why accept can't fire yet, or undefined when it can. */
function acceptBlock(item: TriageItem, answer: string): string | undefined {
  if (!item.input) return undefined;
  if (item.input.deferred) return 'This one has to be answered in the persona builder.';
  if (!answer.trim()) {
    return item.input.kind === 'choice' ? 'Choose an option first.' : 'Type an answer first.';
  }
  return undefined;
}

export function TriageCockpitVariant({
  queue,
  onClose,
  switcher,
}: {
  queue: UnifiedTriageQueue;
  onClose: () => void;
  switcher?: React.ReactNode;
}) {
  const reducedMotion = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState('');
  // The hook sorts skipped items last but doesn't say WHICH they are, so the
  // surface remembers its own deferrals to mark them in the rail.
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(() => new Set());
  const answerRef = useRef<HTMLInputElement>(null);
  const decidingRef = useRef<string | null>(null);

  const groups = useMemo(() => groupQueue(queue.items), [queue.items]);
  const ordered = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const active = ordered.length > 0 ? ordered[Math.min(index, ordered.length - 1)] : null;
  const activeId = active?.id ?? null;
  const busy = queue.busyId !== null;

  // A decided row LEAVES the array (the hook's contract), so holding position
  // lands on the next item; this clamp is what catches the tail of the queue.
  useEffect(() => {
    setIndex((i) => (ordered.length === 0 ? 0 : Math.min(i, ordered.length - 1)));
  }, [ordered.length]);

  useEffect(() => setAnswer(''), [activeId]);
  useEffect(() => {
    decidingRef.current = null;
  }, [activeId, queue.items]);

  const blockedReason = active ? acceptBlock(active, answer) : undefined;

  const onMove = useCallback(
    (delta: number) =>
      setIndex((i) => Math.min(Math.max(i + delta, 0), Math.max(ordered.length - 1, 0))),
    [ordered.length],
  );

  const onSelect = useCallback(
    (id: string) => {
      const at = ordered.findIndex((item) => item.id === id);
      if (at >= 0) setIndex(at);
    },
    [ordered],
  );

  const claim = useCallback((item: TriageItem) => {
    if (decidingRef.current === item.id) return false;
    decidingRef.current = item.id;
    return true;
  }, []);

  const onVerdict = useCallback(
    (verdict: TriageVerdict) => {
      if (!active || busy) return;
      if (verdict === 'accept' && blockedReason) {
        // Don't fail silently: put the cursor where the missing answer goes.
        if (active.input && !active.input.deferred) answerRef.current?.focus();
        return;
      }
      if (!claim(active)) return;
      if (verdict === 'skip') setSkipped((prev) => new Set(prev).add(active.id));
      void queue.decide({
        item: active,
        verdict,
        answer: verdict === 'accept' && active.input ? answer.trim() : undefined,
      });
    },
    [active, busy, blockedReason, answer, queue, claim],
  );

  const onBranch = useCallback(
    (position: number) => {
      if (!active || busy) return;
      const branch = active.branches[position];
      if (!branch || !claim(active)) return;
      void queue.decide({ item: active, verdict: 'accept', branchId: branch.id });
    },
    [active, busy, queue, claim],
  );

  useCockpitKeyboard({ onMove, onVerdict, onBranch, onClose });

  const firstLoad = queue.loading && ordered.length === 0;

  return (
    <motion.div
      data-testid="triage-cockpit"
      role="dialog"
      aria-modal="true"
      aria-label="Triage cockpit"
      initial={reducedMotion ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: EASE }}
      className="fixed inset-x-0 bottom-0 top-12 z-50 flex flex-col bg-background"
    >
      <CockpitHeader
        position={Math.min(index + 1, ordered.length)}
        inView={ordered.length}
        decided={queue.decidedCount}
        sessionTotal={queue.sessionTotal}
        switcher={switcher}
        onClose={onClose}
      />

      {firstLoad ? (
        <CockpitLoading />
      ) : (
        <div className="flex-1 min-h-0 flex">
          <TriageQueueRail
            groups={groups}
            activeId={activeId}
            skippedIds={skipped}
            busyId={queue.busyId}
            allCounts={queue.allCounts}
            activeKinds={queue.activeKinds}
            onToggleKind={queue.toggleKind}
            onSelect={onSelect}
          />

          {active ? (
            <>
              <motion.div
                key={active.id}
                className="flex-1 min-w-0 min-h-0 flex"
                initial={reducedMotion ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18, ease: EASE }}
              >
                <TriageCasePane
                  item={active}
                  answer={answer}
                  onAnswerChange={setAnswer}
                  onAnswerSubmit={() => onVerdict('accept')}
                  busy={busy}
                  answerRef={answerRef}
                />
              </motion.div>
              <TriageLedgerRail
                item={active}
                busy={busy}
                acceptBlockedReason={blockedReason}
                onVerdict={onVerdict}
                onBranch={onBranch}
              />
            </>
          ) : (
            <CockpitEmpty filteredOut={queue.allCounts.total > 0} onReload={queue.reload} />
          )}
        </div>
      )}

      <CockpitFooter />
    </motion.div>
  );
}

export default TriageCockpitVariant;
