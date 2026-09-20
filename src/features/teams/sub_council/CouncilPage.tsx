// Council - the descent from the registry galaxy, through the bench of
// councils waiting on a person, to one council's round table and its gate.
//
// The visual contract is `docs/design/council-reference/index.html`: every
// build of this page is compared against it. This shell owns the header and
// the stage; the galaxy layer mounts inside, and the bench takes the `bench`
// slot below the field without ever hiding it.
import { useCallback, useEffect, useMemo } from 'react';
import { Scale } from 'lucide-react';

import type { CouncilSubjectState } from '@/lib/bindings/CouncilSubjectState';
import { ContentBody, ContentBox, ContentHeader } from '@/features/shared/components/layout/ContentLayout';
import { ROUTE_DECISION_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import { isTypingTarget } from '@/lib/keyboard/KeyboardNavMode';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';

import { CouncilBench } from './bench/CouncilBench';
import { effectiveSubject } from './bench/queueModel';
import { decidableCount } from './councilRules';
import { useCouncilStore } from './councilStore';
import { GalaxyStage } from './galaxy/GalaxyStage';

export default function CouncilPage() {
  const { t, tx } = useTranslation();
  const b = t.council.bench;
  const benchOpen = useCouncilStore((s) => s.benchOpen);
  const setBenchOpen = useCouncilStore((s) => s.setBenchOpen);
  const focusCouncil = useCouncilStore((s) => s.focusCouncil);
  const rawSubjects = useCouncilStore((s) => s.subjects);
  const fixtureDecisions = useCouncilStore((s) => s.fixtureDecisions);
  const subjectsStatus = useCouncilStore((s) => s.subjectsStatus);
  const pendingSubjectId = useSystemStore((s) => s.pendingCouncilSubjectId);
  const setPendingCouncilSubjectId = useSystemStore((s) => s.setPendingCouncilSubjectId);

  const waiting = useMemo(
    () => decidableCount(rawSubjects.map((s) => effectiveSubject(s, fixtureDecisions))),
    [rawSubjects, fixtureDecisions],
  );

  // `Q` raises and drops the bench. It sits at the route layer, below the
  // bench's own handler, so while the bench is up its keys win.
  useAppKeyboard(
    useCallback(
      (e: KeyboardEvent) => {
        if (isTypingTarget(e.target)) return false;
        if (e.key !== 'q' && e.key !== 'Q') return false;
        setBenchOpen(!useCouncilStore.getState().benchOpen);
        return true;
      },
      [setBenchOpen],
    ),
    { priority: ROUTE_DECISION_PRIORITY },
  );

  // Leaving the page drops the bench, so a return lands on the sky rather
  // than inside a drawer the reader does not remember opening.
  useEffect(() => () => setBenchOpen(false), [setBenchOpen]);

  /* The ledger's `ready` row hands off here. The intent waits for the
     councils to arrive rather than being dropped on an empty list, and is
     cleared the moment it is honoured OR the moment the rows land without
     it, so a later visit opens the queue rather than re-opening a council
     the person has since decided. A subject id that no longer resolves is
     cleared too: a stale hand-off must not leave the page waiting forever. */
  useEffect(() => {
    if (!pendingSubjectId) return;
    if (subjectsStatus !== 'loaded') return;
    const s = useCouncilStore.getState();
    const found = s.subjects.find((row) => row.id === pendingSubjectId);
    setPendingCouncilSubjectId(null);
    if (!found) return;
    s.setBenchOpen(true);
    s.setTableSubject(found.id);
    s.focusCouncil(found, null);
  }, [pendingSubjectId, subjectsStatus, setPendingCouncilSubjectId]);

  const aim = useCallback(
    (subject: CouncilSubjectState) => focusCouncil(subject, null),
    [focusCouncil],
  );

  return (
    <ContentBox data-testid="council-page">
      <ContentHeader
        icon={<Scale className="w-5 h-5 text-violet-400" />}
        iconColor="violet"
        title={t.sidebar.council}
        fitWidth
        actions={
          <button
            type="button"
            onClick={() => setBenchOpen(!benchOpen)}
            aria-pressed={benchOpen}
            data-testid="council-bench-toggle"
            className={`inline-flex items-center gap-2 rounded-interactive border px-3 py-1.5 typo-title focus-ring ${
              benchOpen
                ? 'border-primary/60 bg-primary/15 text-primary'
                : 'border-border text-muted hover:text-foreground'
            }`}
          >
            {b.toggle}
            {waiting > 0 ? (
              <span className="rounded-pill bg-status-pending/20 px-1.5 tabular-nums text-status-pending">
                {waiting}
              </span>
            ) : null}
            <kbd className="rounded border border-border px-1 font-mono typo-caption">Q</kbd>
          </button>
        }
      />
      <ContentBody>
        <div data-testid="council-stage" className="relative h-full min-h-0">
          <GalaxyStage
            bench={
              benchOpen ? (
                <section
                  data-testid="council-bench"
                  aria-label={tx(b.headline_many, { count: waiting })}
                  className="flex min-h-0 flex-none flex-col border-t border-border bg-background shadow-[0_-18px_44px_rgba(0,0,0,0.34)]"
                  style={{ height: 'min(68vh, 580px)' }}
                >
                  <CouncilBench onFocusSubject={aim} />
                </section>
              ) : undefined
            }
          />
        </div>
      </ContentBody>
    </ContentBox>
  );
}
