// The bench: the queue of councils that rises over the galaxy without ever
// hiding it, and the round table it opens into.
//
// It spans EVERY project - `listCouncilSubjects()` with no project id - so a
// person who works across repositories sees one queue rather than having to
// remember which project a decision was waiting in. Each row carries its
// project's name for exactly that reason.
//
// The headline counts only decidable rows, and the "uncalibrated" sentence is
// said here, once, in the header. Everywhere else an advisory floor is simply
// drawn dotted.
import { useEffect, useMemo } from 'react';

import type { CouncilSubjectState } from '@/lib/bindings/CouncilSubjectState';
import EmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import Button from '@/features/shared/components/buttons/Button';
import { Scale, TriangleAlert } from 'lucide-react';
import { resolveErrorTranslated } from '@/i18n/useTranslatedError';
import { useTranslation } from '@/i18n/useTranslation';

import { useCouncilStore } from '../councilStore';
import { decidableCount } from '../councilRules';
import { RoundTableLoader } from '../table/RoundTable';
import { effectiveSubject, queueFlat, queueGroups, type QueueGroupKey } from './queueModel';
import { QueuePreview } from './QueuePreview';
import { QueueRow } from './QueueRow';
import { useBenchKeyboard } from './useBenchKeyboard';

const LIST_ID = 'council-queue';

export function CouncilBench({ onFocusSubject }: { onFocusSubject: (s: CouncilSubjectState) => void }) {
  const { t, tx } = useTranslation();
  const b = t.council.bench;

  const rawSubjects = useCouncilStore((s) => s.subjects);
  const fixtureDecisions = useCouncilStore((s) => s.fixtureDecisions);
  const fixtureOn = useCouncilStore((s) => s.fixtureOn);
  const status = useCouncilStore((s) => s.subjectsStatus);
  const error = useCouncilStore((s) => s.subjectsError);
  const refreshCouncils = useCouncilStore((s) => s.refreshCouncils);
  const queueIndex = useCouncilStore((s) => s.queueIndex);
  const setQueueIndex = useCouncilStore((s) => s.setQueueIndex);
  const tableSubjectId = useCouncilStore((s) => s.tableSubjectId);
  const setTableSubject = useCouncilStore((s) => s.setTableSubject);

  const subjects = useMemo(
    () => rawSubjects.map((s) => effectiveSubject(s, fixtureDecisions)),
    [rawSubjects, fixtureDecisions],
  );
  const groups = useMemo(() => queueGroups(subjects), [subjects]);
  const flat = useMemo(() => queueFlat(groups), [groups]);
  const selected = flat[Math.min(queueIndex, Math.max(0, flat.length - 1))] ?? null;
  const waiting = decidableCount(subjects);
  const open = tableSubjectId ? (subjects.find((s) => s.id === tableSubjectId) ?? null) : null;

  const { seatIndex, setSeatIndex } = useBenchKeyboard({ flat, open });

  // Selecting a row aims the sky behind the bench at that council's stars.
  useEffect(() => {
    if (selected) onFocusSubject(selected);
  }, [selected, onFocusSubject]);

  if (open) {
    return (
      <RoundTableLoader
        subject={open}
        onBack={() => setTableSubject(null)}
        seatIndex={seatIndex}
        onSeat={setSeatIndex}
      />
    );
  }

  return (
    <>
      <header className="grid flex-none grid-cols-[1fr_auto] gap-x-[18px] gap-y-1 border-b border-border px-6 pb-3 pt-4">
        {/* A heading INSIDE the page, not the page's own: ContentHeader owns
            the top-level one, and this surface must not declare a second. */}
        <h2 className="m-0 text-[27px] font-bold leading-tight tracking-tight text-foreground">
          {waiting === 0 ? b.headline_none : waiting === 1 ? b.headline_one : tx(b.headline_many, { count: waiting })}
        </h2>
        <p className="m-0 self-center text-right typo-body text-muted-dark">{b.keys_hint}</p>
        <p className="col-span-full m-0 max-w-[104ch] typo-body text-muted">
          {b.lede}
          {fixtureOn ? ` ${b.fixture_mode}` : ''}
        </p>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(320px,0.85fr)_minmax(340px,1fr)]">
        <div
          id={LIST_ID}
          role="listbox"
          aria-label={b.list_label}
          className="overflow-y-auto border-border bg-secondary/[0.04] px-3 pb-5 pt-1.5 lg:border-r"
        >
          {status === 'loading' && flat.length === 0 ? <QueueGhost /> : null}
          {groups.map((group) =>
            group.rows.length === 0 ? null : (
              <div key={group.key}>
                <GroupHeading groupKey={group.key} count={group.rows.length} />
                {group.rows.map((row) => {
                  const i = flat.indexOf(row);
                  return (
                    <QueueRow
                      key={row.id}
                      subject={row}
                      index={i}
                      selected={i === queueIndex}
                      onSelect={setQueueIndex}
                      onOpen={(s) => setTableSubject(s.id)}
                    />
                  );
                })}
              </div>
            ),
          )}
          {/* A read that FAILED is not an empty queue. Saying "no council has
              run yet" here would render the app's own blindness as a fact
              about the councils. */}
          {status === 'failed' && flat.length === 0 ? (
            <div
              data-testid="council-queue-error"
              className="m-2 rounded-card border border-status-error/40 bg-card-bg p-4"
            >
              <div className="flex items-start gap-3">
                <TriangleAlert className="mt-0.5 h-5 w-5 flex-none text-status-error" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="typo-heading text-foreground">{b.failed_title}</p>
                  <p className="mt-1 typo-caption text-muted">
                    {resolveErrorTranslated(t, error instanceof Error ? error.message : String(error ?? '')).message}
                  </p>
                  <Button size="sm" className="mt-3" onClick={() => void refreshCouncils()}>
                    {b.failed_retry}
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
          {status === 'loaded' && flat.length === 0 ? (
            <EmptyState icon={Scale} title={b.empty_title} description={b.empty_description} />
          ) : null}
        </div>
        {selected ? <QueuePreview subject={selected} onOpen={(s) => setTableSubject(s.id)} /> : <div />}
      </div>
    </>
  );
}

function GroupHeading({ groupKey, count }: { groupKey: QueueGroupKey; count: number }) {
  const { t } = useTranslation();
  const b = t.council.bench;
  const title =
    groupKey === 'yours' ? b.group_yours : groupKey === 'machine' ? b.group_machine : b.group_decided;
  const note =
    groupKey === 'yours'
      ? b.group_yours_note
      : groupKey === 'machine'
        ? b.group_machine_note
        : b.group_decided_note;
  return (
    <div className="mx-2 mb-1.5 mt-4 flex flex-wrap items-baseline gap-2">
      <span
        className={`typo-heading uppercase tracking-widest ${
          groupKey === 'yours' ? 'text-status-pending' : 'text-muted'
        }`}
      >
        {title} · {count}
      </span>
      <span className="typo-caption text-muted">{note}</span>
    </div>
  );
}

/** Ghost UNDER the chrome: the header above never moves while this paints. */
function QueueGhost() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-2 pt-4">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          style={{ animationDelay: `${150 + i * 35}ms` }}
          className="flex animate-fade-in items-center gap-3.5 rounded-card px-3 py-2.5"
        >
          <span className="h-[54px] w-[54px] flex-none rounded-full bg-primary/[0.06]" />
          <span className="flex min-w-0 flex-1 flex-col gap-2">
            <span className="h-3.5 w-1/2 rounded bg-primary/[0.06]" />
            <span className="h-3 w-1/3 rounded bg-primary/[0.06]" />
          </span>
        </div>
      ))}
    </div>
  );
}

export default CouncilBench;
