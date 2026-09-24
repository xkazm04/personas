// The seats of one contest as ledger lines — spec chips, role, state, wall
// time, cost, turns — with RunBoard's actions (rerun an unclean seat, open
// its session in the Monitor, fold out its errors), plus the autopilot chain
// as a strip with its retry steps. Extractable: it needs only a detail.
import { useState } from 'react';
import { ChevronDown, ChevronRight, MonitorPlay, RotateCcw } from 'lucide-react';

import { launchContest, runContestStep } from '@/api/contest';
import { AsyncButton, Button } from '@/features/shared/components/buttons';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { StatusBadge } from '@/features/shared/components/display/StatusBadge';
import { useTranslation } from '@/i18n/useTranslation';
import type { ContestDetail } from '@/lib/bindings/ContestDetail';
import type { ContestSeat } from '@/lib/bindings/ContestSeat';
import { toastCatch } from '@/lib/silentCatch';

import { openSessionInMonitor, retrySteps } from '../../components/RunBoard';
import {
  chainStepLabel,
  chainStepTone,
  isRerunnable,
  seatKindLabel,
  seatStateLabel,
  seatStateTone,
  stepLabel,
} from '../../model/labels';
import { LEDGER_COPY as C, fill } from './copy';
import { SeatSpecChips } from './SeatSpecChips';

const SEAT_GRID =
  'grid grid-cols-[2rem_minmax(14rem,1fr)_6rem_8rem_5.5rem_5.5rem_auto] items-center gap-x-3 gap-y-1';

export function SeatLedger({ detail }: { detail: ContestDetail }) {
  const { projectId, contestId } = detail.summary;
  return (
    <section aria-label={C.detailSeats} className="space-y-2" data-testid="ledger-seats">
      <h4 className="typo-label text-foreground">{C.detailSeats}</h4>
      <ul className="divide-y divide-primary/8 rounded-card border border-primary/10">
        {detail.seats.map((seat) => (
          <SeatLine key={`${seat.kind}-${seat.seatId}`} seat={seat} projectId={projectId} contestId={contestId} />
        ))}
      </ul>
    </section>
  );
}

function SeatLine({ seat, projectId, contestId }: { seat: ContestSeat; projectId: string; contestId: string }) {
  const { t, tx } = useTranslation();
  const s = t.plugins.contest;
  const [errorsOpen, setErrorsOpen] = useState(false);
  const errorCount = seat.errors.length;
  return (
    <li className="px-3 py-2" data-testid={`ledger-seat-${seat.seatId}`}>
      <div className={SEAT_GRID}>
        <span className="typo-data text-foreground">{seat.letter ?? '·'}</span>
        <SeatSpecChips spec={seat.spec} />
        <span className="typo-caption text-foreground">{seatKindLabel(s, seat.kind)}</span>
        <StatusBadge variant={seatStateTone(seat.state)} size="sm" pill>
          {seatStateLabel(s, seat.state)}
        </StatusBadge>
        <span className="typo-data text-foreground" aria-label={s.col_wall}>
          <Numeric value={seat.wallS} unit="s" />
        </span>
        <span className="typo-data text-foreground" aria-label={s.col_cost}>
          <Numeric value={seat.costUsd} unit="usd" />
        </span>
        <span className="flex flex-wrap items-center justify-end gap-1">
          {seat.turns !== null && (
            <span className="typo-caption text-foreground">{fill(C.seatTurns, { n: seat.turns })}</span>
          )}
          {errorCount > 0 && (
            <Button
              size="xs"
              variant="ghost"
              aria-expanded={errorsOpen}
              icon={errorsOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              onClick={() => setErrorsOpen((v) => !v)}
            >
              {errorsOpen ? s.seat_errors_hide : tx(s.seat_errors_show, { count: errorCount })}
            </Button>
          )}
          {isRerunnable(seat.state) && (
            <AsyncButton
              size="xs"
              variant="secondary"
              icon={<RotateCcw className="h-3 w-3" />}
              aria-label={tx(s.seat_rerun_aria, { seat: seat.spec })}
              onClick={() =>
                launchContest(projectId, contestId, seat.kind, [seat.seatId]).catch(toastCatch('contest:rerun-seat'))
              }
              data-testid={`ledger-seat-rerun-${seat.seatId}`}
            >
              {C.seatRerun}
            </AsyncButton>
          )}
          {seat.fleetSessionId && (
            <Button
              size="xs"
              variant="ghost"
              icon={<MonitorPlay className="h-3 w-3" />}
              aria-label={s.seat_open_monitor}
              onClick={() => openSessionInMonitor(seat.fleetSessionId!)}
            >
              {C.seatMonitor}
            </Button>
          )}
        </span>
      </div>
      {errorsOpen && errorCount > 0 && (
        <ul className="mt-2 space-y-1 border-t border-primary/10 pt-2">
          {seat.errors.map((e, i) => (
            <li key={i} className="typo-code whitespace-pre-wrap break-words text-foreground">
              {e}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** Collect → visual → judges → ready, with the reason and the retry steps. */
export function ChainStrip({ detail }: { detail: ContestDetail }) {
  const { t, tx } = useTranslation();
  const s = t.plugins.contest;
  const { step, reason, updatedAtMs } = detail.chain;
  const { projectId, contestId } = detail.summary;
  return (
    <section
      aria-label={C.detailChain}
      className="flex flex-wrap items-center gap-2 rounded-card border border-primary/10 bg-secondary/15 px-3 py-2"
      data-testid="ledger-chain"
    >
      <span className="typo-label text-foreground">{C.detailChain}</span>
      <StatusBadge variant={chainStepTone(step)} size="sm" pill>
        {chainStepLabel(s, step)}
      </StatusBadge>
      {reason && <span className="typo-caption text-foreground">{tx(s.chain_reason, { reason })}</span>}
      {updatedAtMs !== null && (
        <RelativeTime timestamp={updatedAtMs} className="typo-caption text-foreground" />
      )}
      {step === 'failed' && (
        <span className="ml-auto flex flex-wrap gap-1.5">
          {retrySteps(detail).map((st) => (
            <AsyncButton
              key={st}
              size="xs"
              variant="secondary"
              icon={<RotateCcw className="h-3 w-3" />}
              onClick={() => runContestStep(projectId, contestId, st).catch(toastCatch('contest:run-step'))}
              data-testid={`ledger-chain-retry-${st}`}
            >
              {tx(s.step_retry, { step: stepLabel(s, st) })}
            </AsyncButton>
          ))}
        </span>
      )}
    </section>
  );
}
