// One lane = one row: [letter] [seat] [track] [state] [elapsed / ceiling]
// [cost]. The fixed-width columns line lanes up vertically; numbers are
// tabular. Variants that crossed the line sit on a second line under the
// seat, beside the lane's few controls (incidents, rerun, Monitor).
import { useState } from 'react';
import { ChevronDown, ChevronRight, MonitorPlay, RotateCcw } from 'lucide-react';

import { launchContest } from '@/api/contest';
import { AsyncButton, Button } from '@/features/shared/components/buttons';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { RevealItem } from '@/features/shared/components/display/RevealItem';
import { useRevealTracker } from '@/hooks/utility/interaction/useProgressiveReveal';
import { useTranslation } from '@/i18n/useTranslation';
import type { ContestPhase } from '@/lib/bindings/ContestPhase';
import type { ContestReviewBucket } from '@/lib/bindings/ContestReviewBucket';
import { toastCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';

import { openSessionInMonitor } from '../components/RunBoard';
import { canRerun, isRerunnable, laneStateLabel, seatStateTone } from '../model/labels';
import type { Lane } from './arenaModel';
import { LaneMeter } from './LaneTrack';
import { SeatLabel } from './SeatLabel';
import { VariantTile } from './VariantTile';

/** Shared with the lane ghost so a cold track has the same geometry. */
export const LANE_GRID =
  'grid grid-cols-[1.25rem_minmax(0,1fr)_auto] gap-x-3 gap-y-1 md:grid-cols-[1.25rem_minmax(8rem,12rem)_minmax(4rem,1fr)_minmax(6.5rem,9rem)_8.5rem_4.5rem] md:items-center';

export interface SeatLaneProps {
  lane: Lane;
  projectId: string;
  contestId: string;
  /** The contest phase: a rerun is offered only where it cannot undo a verdict. */
  phase: ContestPhase;
  ceilingS: number | null;
  bucketOf: (key: string) => ContestReviewBucket | null;
  onOpenVariant: (key: string) => void;
}

export function SeatLane({ lane, projectId, contestId, phase, ceilingS, bucketOf, onOpenVariant }: SeatLaneProps) {
  const { t, tx } = useTranslation();
  const a = t.plugins.contest.arena;
  const { seat, variants } = lane;
  const [open, setOpen] = useState(false);
  const enter = useRevealTracker(`${projectId}/${contestId}/${seat.seatId}`);
  // The seat's own start time; the Monitor session's is only a fallback.
  const monitorStartMs = useSystemStore((s) => {
    if (seat.startedAtMs !== null || !seat.fleetSessionId) return null;
    const fs = s.fleetSessions.find((f) => f.id === seat.fleetSessionId);
    return fs ? Number(fs.createdAtMs) : null;
  });
  const startedAtMs = seat.startedAtMs ?? monitorStartMs;
  const rerunnable = isRerunnable(seat.state) && canRerun(phase, seat.kind);
  const hasControls = seat.errors.length > 0 || rerunnable || seat.fleetSessionId !== null;

  return (
    <li className="space-y-1.5 py-2" data-testid={`arena-lane-${seat.seatId}`}>
      <div className={LANE_GRID}>
        <span className="typo-label text-primary" aria-label={seat.letter ? tx(a.lane_letter, { letter: seat.letter }) : a.lane_unlettered}>
          {seat.letter ?? '—'}
        </span>
        <SeatLabel spec={seat.spec} />
        <LaneMeter
          state={seat.state}
          stateLabel={laneStateLabel(a, seat.state)}
          stateTone={seatStateTone(seat.state)}
          wallS={seat.wallS}
          startedAtMs={startedAtMs}
          ceilingS={ceilingS}
        />
        <span className="typo-data text-right text-foreground" aria-label={a.cost}>
          <Numeric value={seat.costUsd} unit="usd" />
        </span>
      </div>

      {(variants.length > 0 || hasControls) && (
        <div className="flex flex-wrap items-center gap-2 pl-8">
          {variants.length > 0 && (
            <ul className="flex gap-1.5 overflow-x-auto" aria-label={a.variants_label}>
              {variants.map((v, i) => (
                <RevealItem as="li" key={v.key} revealId={v.key} order={i} hasEntered={enter.hasEntered} markEntered={enter.markEntered} className="shrink-0">
                  <VariantTile variant={v} bucket={bucketOf(v.key)} onOpen={onOpenVariant} />
                </RevealItem>
              ))}
            </ul>
          )}
          {hasControls && (
            <div className="flex flex-wrap items-center gap-1">
              {seat.errors.length > 0 && (
                <Button
                  size="xs"
                  variant="ghost"
                  className="typo-caption"
                  aria-expanded={open}
                  icon={open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                  onClick={() => setOpen((v) => !v)}
                >
                  {open ? a.errors_hide : tx(seat.errors.length === 1 ? a.errors_show_one : a.errors_show_other, { count: seat.errors.length })}
                </Button>
              )}
              {rerunnable && (
                <AsyncButton
                  size="xs"
                  variant="secondary"
                  className="typo-caption"
                  icon={<RotateCcw className="w-3 h-3" />}
                  onClick={() => launchContest(projectId, contestId, seat.kind, [seat.seatId]).catch(toastCatch('contest:arena-rerun'))}
                  data-testid={`arena-lane-rerun-${seat.seatId}`}
                >
                  {a.rerun}
                </AsyncButton>
              )}
              {seat.fleetSessionId && (
                <Button
                  size="xs"
                  variant="ghost"
                  className="typo-caption"
                  icon={<MonitorPlay className="w-3 h-3" />}
                  onClick={() => openSessionInMonitor(seat.fleetSessionId!)}
                >
                  {a.monitor}
                </Button>
              )}
            </div>
          )}
        </div>
      )}
      {open && seat.errors.length > 0 && (
        <ul className="ml-8 space-y-1 border-l border-status-error/30 pl-3">
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
