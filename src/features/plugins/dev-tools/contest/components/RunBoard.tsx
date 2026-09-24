// The live seats of one contest and the autopilot chain behind them.
//
// Per seat: spec, role, state, wall time, cost, errors (expandable), and the
// actions that make sense for it — rerun a seat that did not finish cleanly,
// open its fleet session in the Monitor. The chain line says where the
// autopilot is and, when it stopped, why, with a retry per step.
import { useState } from 'react';
import { ChevronDown, ChevronRight, MonitorPlay, Play, RotateCcw, Square } from 'lucide-react';

import { cancelContest, launchContest, runContestStep } from '@/api/contest';
import { AsyncButton, Button } from '@/features/shared/components/buttons';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { StatusBadge } from '@/features/shared/components/display/StatusBadge';
import { ConfirmDialog } from '@/features/shared/components/feedback/ConfirmDialog';
import { useTranslation } from '@/i18n/useTranslation';
import type { ContestDetail } from '@/lib/bindings/ContestDetail';
import type { ContestSeat } from '@/lib/bindings/ContestSeat';
import type { ContestStep } from '@/lib/bindings/ContestStep';
import { toastCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';

import {
  chainStepLabel,
  chainStepTone,
  isRerunnable,
  seatKindLabel,
  seatStateLabel,
  seatStateTone,
  stepLabel,
} from '../model/labels';

export interface RunBoardProps {
  detail: ContestDetail;
  className?: string;
}

/** Open a fleet session in the Monitor — the same door Athena's refs use. */
export function openSessionInMonitor(sessionId: string): void {
  const sys = useSystemStore.getState();
  sys.fleetSetActiveSession(sessionId);
  sys.fleetSetGridOpen(true);
}

/** Steps worth offering as a retry: judging steps only when judges ran. */
export function retrySteps(detail: Pick<ContestDetail, 'judgesEnabled'>): ContestStep[] {
  return detail.judgesEnabled ? ['collect', 'visual', 'judge', 'aggregate'] : ['collect', 'visual'];
}

export function RunBoard({ detail, className = '' }: RunBoardProps) {
  const { t } = useTranslation();
  const s = t.plugins.contest;
  const { projectId, contestId, phase } = detail.summary;
  const [confirmCancel, setConfirmCancel] = useState(false);
  const live = phase === 'queued' || phase === 'running' || phase === 'collecting' || phase === 'judging';

  return (
    <section className={`space-y-3 ${className}`} aria-label={s.run_title} data-testid="contest-run-board">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="typo-heading flex-1">{s.run_title}</h3>
        {phase === 'draft' && (
          <AsyncButton
            size="sm"
            variant="primary"
            icon={<Play className="w-3.5 h-3.5" />}
            onClick={() =>
              launchContest(projectId, contestId, 'participant').catch(toastCatch('contest:launch'))
            }
            data-testid="contest-run-launch"
          >
            {s.run_launch}
          </AsyncButton>
        )}
        {live && (
          <Button
            size="sm"
            variant="danger"
            icon={<Square className="w-3.5 h-3.5" />}
            onClick={() => setConfirmCancel(true)}
            data-testid="contest-run-cancel"
          >
            {s.run_cancel}
          </Button>
        )}
      </div>

      <ChainLine detail={detail} />

      <ul className="space-y-1.5">
        {detail.seats.map((seat) => (
          <SeatRow key={`${seat.kind}-${seat.seatId}`} seat={seat} projectId={projectId} contestId={contestId} />
        ))}
      </ul>

      {confirmCancel && (
        <ConfirmDialog
          danger
          title={s.cancel_confirm_title}
          body={s.cancel_confirm_body}
          confirmLabel={s.run_cancel}
          onCancel={() => setConfirmCancel(false)}
          onConfirm={async () => {
            try {
              await cancelContest(projectId, contestId);
              setConfirmCancel(false);
            } catch (err) {
              toastCatch('contest:cancel')(err);
            }
          }}
        />
      )}
    </section>
  );
}

function ChainLine({ detail }: { detail: ContestDetail }) {
  const { t, tx } = useTranslation();
  const s = t.plugins.contest;
  const { step, reason } = detail.chain;
  const { projectId, contestId } = detail.summary;
  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-card border border-primary/12 bg-secondary/20 px-3 py-2"
      data-testid="contest-chain-line"
    >
      <span className="typo-label text-foreground">{s.chain_label}</span>
      <StatusBadge variant={chainStepTone(step)} size="sm" pill>
        {chainStepLabel(s, step)}
      </StatusBadge>
      {reason && <span className="typo-caption text-foreground">{tx(s.chain_reason, { reason })}</span>}
      {step === 'failed' && (
        <div className="flex flex-wrap gap-1.5 ml-auto">
          {retrySteps(detail).map((st) => (
            <AsyncButton
              key={st}
              size="xs"
              variant="secondary"
              icon={<RotateCcw className="w-3 h-3" />}
              onClick={() => runContestStep(projectId, contestId, st).catch(toastCatch('contest:run-step'))}
              data-testid={`contest-chain-retry-${st}`}
            >
              {tx(s.step_retry, { step: stepLabel(s, st) })}
            </AsyncButton>
          ))}
        </div>
      )}
    </div>
  );
}

interface SeatRowProps {
  seat: ContestSeat;
  projectId: string;
  contestId: string;
}

function SeatRow({ seat, projectId, contestId }: SeatRowProps) {
  const { t, tx } = useTranslation();
  const s = t.plugins.contest;
  const [open, setOpen] = useState(false);
  const errorCount = seat.errors.length;

  return (
    <li
      className="rounded-card border border-primary/10 bg-secondary/20 px-3 py-2"
      data-testid={`contest-seat-row-${seat.seatId}`}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <span className="typo-code text-foreground min-w-0 break-all flex-1">{seat.spec}</span>
        {seat.letter && <span className="typo-label text-foreground">{tx(s.seat_letter, { letter: seat.letter })}</span>}
        <span className="typo-caption text-foreground">{seatKindLabel(s, seat.kind)}</span>
        <StatusBadge variant={seatStateTone(seat.state)} size="sm" pill>
          {seatStateLabel(s, seat.state)}
        </StatusBadge>
        <span className="typo-caption text-foreground" aria-label={s.col_wall}>
          <Numeric value={seat.wallS} unit="s" />
        </span>
        <span className="typo-caption text-foreground" aria-label={s.col_cost}>
          <Numeric value={seat.costUsd} unit="usd" />
        </span>
        <div className="flex items-center gap-1.5">
          {errorCount > 0 && (
            <Button
              size="xs"
              variant="ghost"
              aria-expanded={open}
              icon={open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              onClick={() => setOpen((v) => !v)}
            >
              {open ? s.seat_errors_hide : tx(s.seat_errors_show, { count: errorCount })}
            </Button>
          )}
          {isRerunnable(seat.state) && (
            <AsyncButton
              size="xs"
              variant="secondary"
              icon={<RotateCcw className="w-3 h-3" />}
              aria-label={tx(s.seat_rerun_aria, { seat: seat.spec })}
              onClick={() =>
                launchContest(projectId, contestId, seat.kind, [seat.seatId]).catch(toastCatch('contest:rerun-seat'))
              }
              data-testid={`contest-seat-rerun-${seat.seatId}`}
            >
              {s.seat_rerun}
            </AsyncButton>
          )}
          {seat.fleetSessionId && (
            <Button
              size="xs"
              variant="ghost"
              icon={<MonitorPlay className="w-3 h-3" />}
              onClick={() => openSessionInMonitor(seat.fleetSessionId!)}
            >
              {s.seat_open_monitor}
            </Button>
          )}
        </div>
      </div>
      {open && errorCount > 0 && (
        <ul className="mt-2 space-y-1 border-t border-primary/10 pt-2">
          {seat.errors.map((e, i) => (
            <li key={i} className="typo-code text-foreground whitespace-pre-wrap break-words">
              {e}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
