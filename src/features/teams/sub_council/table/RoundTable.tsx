// The round table: one council, seated.
//
// The frame is fixed and the reader never loses it - header across the top
// (where it came from, what it is, how its rounds went, which stars it
// lands on), the rose and the council's one-line reading on the left, the
// five member seats and the chosen member's reading on the right, and the
// gate pinned in the footer where it is always in view.
import { useMemo, useState } from 'react';
import { ChevronLeft } from 'lucide-react';

import type { CouncilSubjectState } from '@/lib/bindings/CouncilSubjectState';
import Button from '@/features/shared/components/buttons/Button';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';

import { useCouncilStore } from '../councilStore';
import { StateChip, Tag, kindWord } from '../bench/chips';
import { CouncilGateBay } from '../gate/CouncilGateBay';
import { whyLine } from './councilCopy';
import { MemberReading } from './MemberReading';
import { resolveRubric } from './rubrics';
import { seatsOf, weakestFinding } from './runModel';
import { Constellation } from './svg/Constellation';
import { CoverageRing } from './svg/CoverageRing';
import { Rose } from './svg/Rose';
import { RoundHistory } from './svg/RoundHistory';
import { useCouncilRun } from './useCouncilRun';
import { usePercent } from './usePercent';
import type { CouncilRunView } from './useCouncilRun';

export function RoundTable({
  subject,
  onBack,
  seatIndex,
  onSeat,
  run,
}: {
  subject: CouncilSubjectState;
  onBack: () => void;
  seatIndex: number | null;
  onSeat: (index: number) => void;
  run: CouncilRunView;
}) {
  const { t, tx } = useTranslation();
  const b = t.council.bench;
  const tbl = t.council.table;
  const percent = usePercent();
  const layout = useCouncilStore((s) => s.layout);

  const detail = run.detail;
  const { rubric, matched } = resolveRubric(detail?.run.rubricVersion ?? null, subject.kind);
  const seats = useMemo(
    () => seatsOf(detail?.run ?? null, subject.kind, detail?.verdicts ?? []),
    [detail, subject.kind],
  );
  const weakest = useMemo(() => weakestFinding(seats), [seats]);
  const fallbackSeat = weakest ? Math.max(0, seats.findIndex((s) => s.name === weakest.seat.name)) : 0;
  const seat = seats[seatIndex ?? fallbackSeat] ?? seats[0];
  const overall = detail ? detail.run.overall : subject.overall;
  const coverage = detail ? detail.run.coverage : subject.coverage;
  const why = whyLine(seats, overall, coverage, rubric, percent);

  const stars = useMemo(
    () =>
      layout
        ? subject.registrySubjects
            .map((slug) => layout.bySlug.get(slug))
            .filter((s): s is NonNullable<typeof s> => Boolean(s))
        : [],
    [layout, subject.registrySubjects],
  );

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_1fr_auto] lg:grid-cols-[minmax(380px,42%)_1fr]">
      <header className="col-span-full flex items-center gap-6 border-b border-border px-7 py-3.5">
        <div className="min-w-0 flex-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            icon={<ChevronLeft className="h-4 w-4" />}
            data-testid="council-back-to-queue"
          >
            {tbl.back_to_queue}
          </Button>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <StateChip state={subject.state} />
            <Tag>{subject.projectName}</Tag>
            <Tag>{kindWord(subject, b)}</Tag>
            {detail ? <Tag>{tx(tbl.round, { round: detail.run.roundNo })}</Tag> : null}
          </div>
          {/* A heading INSIDE the page: the page's own top-level heading
              belongs to ContentHeader, and this is the subject's name. */}
          <h2 className="m-0 mt-1.5 text-[34px] font-bold leading-tight tracking-tight text-foreground">
            {subject.title}
          </h2>
        </div>
        {run.chain.length > 0 ? (
          <div className="flex-none rounded-card border border-border bg-secondary/[0.04] px-2.5 py-0.5">
            <RoundHistory
              points={run.chain.map((d) => ({
                roundNo: d.run.roundNo,
                overall: d.run.overall,
                runId: d.run.id,
              }))}
              threshold={rubric.threshold}
              currentRound={detail?.run.roundNo ?? 1}
              label={tbl.rounds_label}
              noOverallLabel={tbl.rose_no_overall}
              roundLabel={(n) => tx(tbl.round, { round: n })}
              onPickRound={run.showRound}
            />
          </div>
        ) : null}
        <Constellation stars={stars} />
      </header>

      <div className="flex min-h-0 flex-col items-center gap-2.5 overflow-y-auto border-border px-6 pb-7 pt-4 lg:border-r">
        <Rose
          seats={seats}
          threshold={rubric.threshold}
          overall={overall}
          size={260}
          selectedIndex={seat ? seats.indexOf(seat) : null}
          onSelectSeat={onSeat}
          label={tbl.rose_label}
          notMeasuredLabel={tbl.not_measured}
          noOverallLabel={tbl.rose_no_overall}
          overallLabel={tbl.rose_overall}
        />
        <p className="m-0 max-w-[38ch] text-center text-[17px] font-semibold leading-snug text-foreground">
          {tx(tbl[why.key], why.values)}
        </p>
        <div className="mt-0.5 flex items-center gap-2.5">
          <CoverageRing
            coverage={coverage ?? 0}
            floor={rubric.coverageFloor}
            label={tx(tbl.coverage_label, {
              percent: percent(coverage ?? 0),
              percent_floor: percent(rubric.coverageFloor),
            })}
            text={percent(coverage ?? 0)}
          />
          <span className="typo-body text-muted">
            <b className="block typo-title text-foreground">{tbl.coverage}</b>
            {tx(tbl.coverage_floor, { percent: percent(rubric.coverageFloor) })}
          </span>
        </div>
        {!matched && detail ? (
          <p className="m-0 max-w-[40ch] text-center typo-caption text-status-warning">
            {tx(tbl.rubric_unknown, { version: detail.run.rubricVersion, fallback: rubric.version })}
          </p>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-col gap-5 overflow-y-auto px-8 pb-11 pt-5">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label={tbl.seats_label}>
          {seats.map((s, i) => (
            <button
              key={s.name}
              type="button"
              role="tab"
              aria-selected={s === seat}
              onClick={() => onSeat(i)}
              id={`council-seat-${i}`}
              aria-controls="council-member-panel"
              data-testid="council-seat-tab"
              className={`rounded-pill border px-4 py-1.5 typo-title capitalize transition-colors ${
                s === seat
                  ? 'border-transparent bg-foreground text-background'
                  : 'border-border bg-secondary/[0.05] text-muted hover:text-foreground'
              }`}
            >
              <span className="mr-1.5 font-mono typo-caption opacity-75">{i + 1}</span>
              {s.name}
              {weakest?.seat.name === s.name ? (
                <Tooltip content={tbl.seat_weakest}>
                  <span className="ml-1 text-status-warning">▼</span>
                </Tooltip>
              ) : null}
            </button>
          ))}
        </div>
        {/* The panel the tablist above says it controls. Declared, not
            implied by the layout (census `tabstrip-with-no-declared-panel`). */}
        <div
          role="tabpanel"
          id="council-member-panel"
          aria-labelledby={seat ? `council-seat-${seats.indexOf(seat)}` : undefined}
        >
          {seat ? <MemberReading seat={seat} detail={detail} weakest={weakest} /> : null}
        </div>
      </div>

      <footer className="col-span-full border-t border-border px-7 py-3">
        <CouncilGateBay subject={subject} detail={detail} rubric={rubric} onReload={run.reload} />
      </footer>
    </div>
  );
}

/** The table, wired to its own fetch. Keeps `RoundTable` pure over its data. */
export function RoundTableLoader({
  subject,
  onBack,
  seatIndex,
  onSeat,
}: {
  subject: CouncilSubjectState;
  onBack: () => void;
  seatIndex: number | null;
  onSeat: (index: number) => void;
}) {
  const run = useCouncilRun(subject.latestRunId);
  return <RoundTable subject={subject} onBack={onBack} seatIndex={seatIndex} onSeat={onSeat} run={run} />;
}

export function useSeatCount(subject: CouncilSubjectState): number {
  const [count] = useState(() => Object.keys(resolveRubric(null, subject.kind).rubric.dimensions).length);
  return count;
}

export default RoundTable;
