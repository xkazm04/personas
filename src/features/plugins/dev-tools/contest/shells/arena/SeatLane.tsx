// One lane per seat: who is racing (engine · model · effort), where they are
// (grid → racing → the outcome token), what it cost them, and the variants
// that crossed the line landing in the lane as they arrive.
import { useState } from 'react';
import { ChevronDown, ChevronRight, MonitorPlay, RotateCcw } from 'lucide-react';

import { launchContest } from '@/api/contest';
import { AsyncButton, Button } from '@/features/shared/components/buttons';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { RevealItem } from '@/features/shared/components/display/RevealItem';
import { StatusBadge } from '@/features/shared/components/display/StatusBadge';
import { useRevealTracker } from '@/hooks/utility/interaction/useProgressiveReveal';
import type { ContestReviewBucket } from '@/lib/bindings/ContestReviewBucket';
import { toastCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';

import { openSessionInMonitor } from '../../components/RunBoard';
import { isRerunnable, seatStateTone } from '../../model/labels';
import type { Lane } from './arenaModel';
import { ARENA, LANE_STATE } from './copy';
import { LaneTrack } from './LaneTrack';
import { SeatSpecChips } from './SeatSpecChips';
import { VariantTile } from './VariantTile';

export interface SeatLaneProps {
  lane: Lane;
  projectId: string;
  contestId: string;
  ceilingS: number | null;
  bucketOf: (key: string) => ContestReviewBucket | null;
  onOpenVariant: (key: string) => void;
}

export function SeatLane({ lane, projectId, contestId, ceilingS, bucketOf, onOpenVariant }: SeatLaneProps) {
  const { seat, variants } = lane;
  const [open, setOpen] = useState(false);
  const enter = useRevealTracker(`${projectId}/${contestId}/${seat.seatId}`);
  // The Monitor store knows when the fleet session started; absent → null.
  const startedAtMs = useSystemStore((s) => {
    const fs = seat.fleetSessionId ? s.fleetSessions.find((f) => f.id === seat.fleetSessionId) : undefined;
    return fs ? Number(fs.createdAtMs) : null;
  });

  return (
    <li className="rounded-card border border-primary/10 bg-secondary/15 px-3 py-2.5 space-y-2" data-testid={`arena-lane-${seat.seatId}`}>
      <div className="grid gap-3 md:grid-cols-[minmax(12rem,16rem)_1fr_auto] md:items-center">
        <div className="min-w-0 space-y-1">
          <span className="typo-label text-primary">{seat.letter ? ARENA.laneLetter(seat.letter) : ARENA.laneUnlettered}</span>
          <SeatSpecChips spec={seat.spec} />
        </div>
        <LaneTrack state={seat.state} wallS={seat.wallS} startedAtMs={startedAtMs} ceilingS={ceilingS} />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 md:justify-end">
          <StatusBadge variant={seatStateTone(seat.state)} size="sm" pill>
            {LANE_STATE[seat.state]}
          </StatusBadge>
          <span className="typo-caption text-foreground" aria-label={ARENA.wall}>
            <Numeric value={seat.wallS} unit="s" />
          </span>
          <span className="typo-caption text-foreground" aria-label={ARENA.cost}>
            <Numeric value={seat.costUsd} unit="usd" />
          </span>
        </div>
      </div>

      {variants.length > 0 ? (
        <ul className="flex gap-2 overflow-x-auto pb-1" aria-label={ARENA.lanesLabel}>
          {variants.map((v, i) => (
            <RevealItem as="li" key={v.key} revealId={v.key} order={i} hasEntered={enter.hasEntered} markEntered={enter.markEntered} className="shrink-0">
              <VariantTile variant={v} bucket={bucketOf(v.key)} onOpen={onOpenVariant} />
            </RevealItem>
          ))}
        </ul>
      ) : seat.kind === 'participant' ? (
        <p className="typo-caption text-foreground">{ARENA.laneTilesEmpty}</p>
      ) : null}

      <div className="flex flex-wrap items-center gap-1.5">
        {seat.errors.length > 0 && (
          <Button
            size="xs"
            variant="ghost"
            aria-expanded={open}
            icon={open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? ARENA.errorsHide : ARENA.errorsShow(seat.errors.length)}
          </Button>
        )}
        {isRerunnable(seat.state) && (
          <AsyncButton
            size="xs"
            variant="secondary"
            icon={<RotateCcw className="w-3 h-3" />}
            onClick={() => launchContest(projectId, contestId, seat.kind, [seat.seatId]).catch(toastCatch('contest:arena-rerun'))}
            data-testid={`arena-lane-rerun-${seat.seatId}`}
          >
            {ARENA.rerun}
          </AsyncButton>
        )}
        {seat.fleetSessionId && (
          <Button size="xs" variant="ghost" icon={<MonitorPlay className="w-3 h-3" />} onClick={() => openSessionInMonitor(seat.fleetSessionId!)}>
            {ARENA.monitor}
          </Button>
        )}
      </div>
      {open && seat.errors.length > 0 && (
        <ul className="space-y-1 border-t border-primary/10 pt-2">
          {seat.errors.map((e, i) => (
            <li key={i} className="typo-caption font-mono text-foreground whitespace-pre-wrap break-words">
              {e}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
