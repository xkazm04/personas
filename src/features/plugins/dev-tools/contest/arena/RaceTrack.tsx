// The centre: the race on the track. A header (the race, its phase, start /
// stop), one lane per seat, the stewards' lanes when judges run, and the
// finish-line strip. When every variant is in, a "Photo finish" call opens
// the review lightbox.
import { useState } from 'react';
import { Camera, Play, Square } from 'lucide-react';

import { cancelContest, launchContest } from '@/api/contest';
import { AsyncButton, Button } from '@/features/shared/components/buttons';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { StatusBadge } from '@/features/shared/components/display/StatusBadge';
import { ConfirmDialog } from '@/features/shared/components/feedback/ConfirmDialog';
import { useTranslation } from '@/i18n/useTranslation';
import type { ContestDetail } from '@/lib/bindings/ContestDetail';
import { toastCatch } from '@/lib/silentCatch';

import type { ReviewDraft } from '../hooks/useReviewDraft';
import { phaseLabel, phaseTone } from '../model/labels';
import { variantReview } from '../model/reviewModel';
import { buildLanes, isLivePhase, relevantLayer, type Lane } from './arenaModel';
import { ARENA } from './copy';
import { FinishLine } from './FinishLine';
import { SeatLane } from './SeatLane';

export interface RaceTrackProps {
  detail: ContestDetail;
  draft: ReviewDraft;
  onOpenVariant: (key: string) => void;
}

export function RaceTrack({ detail, draft, onOpenVariant }: RaceTrackProps) {
  const { t } = useTranslation();
  const s = t.plugins.contest;
  const { summary } = detail;
  const { projectId, contestId, phase } = summary;
  const [confirmStop, setConfirmStop] = useState(false);
  const { racers, stewards } = buildLanes(detail);
  const bucketOf = (key: string) => (draft.review ? variantReview(draft.review, key).bucket : null);
  const firstVariant = detail.variants[0]?.key ?? null;
  // The ceiling (timeout_min) is not on ContestDetail yet — see the handoff.
  const ceilingS: number | null = null;

  const renderLanes = (lanes: Lane[]) => (
    <ul className="space-y-2">
      {lanes.map((lane) => (
        <SeatLane
          key={`${lane.seat.kind}-${lane.seat.seatId}`}
          lane={lane}
          projectId={projectId}
          contestId={contestId}
          ceilingS={ceilingS}
          bucketOf={bucketOf}
          onOpenVariant={onOpenVariant}
        />
      ))}
    </ul>
  );

  return (
    <section className="space-y-4" aria-label={summary.title} data-testid="arena-track">
      <header className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="typo-heading-lg truncate">{summary.title}</h3>
            <StatusBadge variant={phaseTone(phase)} size="md" pill>
              {phaseLabel(s, phase)}
            </StatusBadge>
            {summary.round !== null && <span className="typo-caption text-foreground">{ARENA.roundN(summary.round)}</span>}
          </div>
          <p className="typo-caption text-foreground">
            {summary.projectName} · <span className="font-mono">{contestId}</span>
            {detail.notBeforeMs !== null && (
              <>
                {' · '}
                {ARENA.notBefore} <RelativeTime timestamp={detail.notBeforeMs} className="typo-caption text-foreground" />
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {phase === 'draft' && (
            <AsyncButton
              size="sm"
              variant="primary"
              icon={<Play className="w-3.5 h-3.5" />}
              onClick={() => launchContest(projectId, contestId, 'participant').catch(toastCatch('contest:arena-launch'))}
              data-testid="arena-launch"
            >
              {ARENA.launch}
            </AsyncButton>
          )}
          {isLivePhase(phase) && (
            <Button size="sm" variant="danger" icon={<Square className="w-3.5 h-3.5" />} onClick={() => setConfirmStop(true)} data-testid="arena-cancel">
              {ARENA.cancel}
            </Button>
          )}
          {firstVariant && (
            <Button
              size="sm"
              variant={relevantLayer(phase) === 'review' ? 'primary' : 'secondary'}
              icon={<Camera className="w-3.5 h-3.5" />}
              onClick={() => onOpenVariant(firstVariant)}
              data-testid="arena-open-photo-finish"
            >
              {ARENA.photoFinish}
            </Button>
          )}
        </div>
      </header>

      {relevantLayer(phase) === 'review' && <p className="typo-caption text-foreground">{ARENA.photoFinishHint}</p>}

      <div className="space-y-2">
        <h4 className="typo-label text-foreground">{ARENA.lanesLabel}</h4>
        {renderLanes(racers)}
      </div>
      {stewards.length > 0 && (
        <div className="space-y-2">
          <h4 className="typo-label text-foreground">{ARENA.stewardsLabel}</h4>
          {renderLanes(stewards)}
        </div>
      )}

      <FinishLine detail={detail} />

      {confirmStop && (
        <ConfirmDialog
          danger
          title={ARENA.cancelTitle}
          body={ARENA.cancelBody}
          confirmLabel={ARENA.cancel}
          onCancel={() => setConfirmStop(false)}
          onConfirm={async () => {
            try {
              await cancelContest(projectId, contestId);
              setConfirmStop(false);
            } catch (err) {
              toastCatch('contest:arena-cancel')(err);
            }
          }}
        />
      )}
    </section>
  );
}
