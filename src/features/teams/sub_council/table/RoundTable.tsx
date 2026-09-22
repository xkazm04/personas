// The round table: one council, seated.
//
// The frame is fixed and the reader never loses it - header across the top
// (where it came from, what it is, how its rounds went, which stars it
// lands on), the rose and the council's one-line reading on the left, the
// five member seats and the chosen member's reading on the right, and the
// gate pinned in the footer where it is always in view.
import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronLeft } from 'lucide-react';

import { MOTION_PRESETS } from '@/lib/utils/animation/animationPresets';

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
import { useElementSize } from '@/hooks/utility/interaction/useElementSize';
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
  const rootRef = useRef<HTMLDivElement | null>(null);
  const roseColRef = useRef<HTMLDivElement | null>(null);
  const { width: tableWidth } = useElementSize(rootRef);
  const { height: roseColHeight } = useElementSize(roseColRef);
  /* Below this the header's two cards stop fitting beside a title that has
     to stay on one line, so they stand down rather than squeezing it. */
  const roomForHeaderCards = tableWidth === 0 || tableWidth >= 1100;
  /* The rose is the one elastic thing in the left column: it gives way so
     the why-line and the coverage ring under it always clear the fold,
     which is what the reference's own `fitTable` does by re-measuring. The
     reserve is what those two need (~170 px plus the column's padding). */
  const roseSize = Math.max(150, Math.min(300, roseColHeight - 205));
  const roundStep = useCouncilStore((s) => s.roundStep);
  const clearRoundStep = useCouncilStore((s) => s.clearRoundStep);

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

  // `[` and `]` walk the chain the table already holds, and stop at its ends
  // rather than wrapping: a reader pressing `[` twice on round 1 should not
  // land on the latest round.
  useEffect(() => {
    if (roundStep === 0 || run.chain.length === 0) return;
    const at = run.chain.findIndex((d) => d.run.id === detail?.run.id);
    const next = run.chain[Math.max(0, Math.min(run.chain.length - 1, (at < 0 ? 0 : at) + roundStep))];
    if (next) run.showRound(next.run.id);
    clearRoundStep();
  }, [roundStep, run, detail, clearRoundStep]);

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
    /* The table SLIDES IN over the queue it was opened from, on the app's
       `gentle` rung - the same 400 ms the camera and the bench move on, so
       opening a council reads as one gesture rather than three. */
    <motion.div
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      transition={MOTION_PRESETS.gentle.framer}
      ref={rootRef}
      className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_1fr_auto] lg:grid-cols-[minmax(340px,40%)_1fr]"
    >
      <header className="col-span-full flex items-center gap-6 border-b border-border px-7 py-2.5">
        <div className="min-w-0 flex-1">
          {/* The way back shares the chip row: a line of header height is a
              line the rose does not get. */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={onBack}
              icon={<ChevronLeft className="h-4 w-4" />}
              data-testid="council-back-to-queue"
            >
              {tbl.back_to_queue}
            </Button>
            <StateChip state={subject.state} />
            <Tag>{subject.projectName}</Tag>
            <Tag>{kindWord(subject, b)}</Tag>
            {detail ? <Tag>{tx(tbl.round, { round: detail.run.roundNo })}</Tag> : null}
          </div>
          {/* A heading INSIDE the page: the page's own top-level heading
              belongs to ContentHeader, and this is the subject's name. */}
          <h2 className="m-0 mt-0.5 truncate typo-heading-lg text-foreground">
            {subject.title}
          </h2>
        </div>
        {run.chain.length > 0 && roomForHeaderCards ? (
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
        {roomForHeaderCards ? <Constellation stars={stars} /> : null}
      </header>

      <div
        ref={roseColRef}
        className="flex min-h-0 flex-col items-center gap-2 overflow-hidden border-border px-6 pb-4 pt-3 lg:border-r"
      >
        <Rose
          seats={seats}
          threshold={rubric.threshold}
          overall={overall}
          size={roseSize}
          selectedIndex={seat ? seats.indexOf(seat) : null}
          onSelectSeat={onSeat}
          label={tbl.rose_label}
          notMeasuredLabel={tbl.not_measured}
          noOverallLabel={tbl.rose_no_overall}
          overallLabel={tbl.rose_overall}
        />
        <p className="m-0 max-w-[38ch] text-center typo-body-lg text-foreground">
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
            <b className="block typo-heading text-foreground">{tbl.coverage}</b>
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
              className={`rounded-pill border px-4 py-1.5 typo-heading capitalize transition-colors ${
                s === seat
                  ? 'border-transparent bg-foreground text-background'
                  : 'border-border bg-secondary/[0.05] text-muted hover:text-foreground'
              }`}
            >
              <span className="mr-1.5 font-mono opacity-70">{i + 1}</span>
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
    </motion.div>
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
