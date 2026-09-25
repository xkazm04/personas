// The centre: the race on the track. A header (the race, one muted meta line,
// start / stop / photo finish), one lane per seat, the stewards' lanes when
// judges run, and the finish-line strip. When every variant is in, "Photo
// finish" becomes the primary action and opens the review lightbox.
import { useState } from 'react';
import { Camera, Play, Square, Trophy } from 'lucide-react';

import { cancelContest, launchContest } from '@/api/contest';
import { AsyncButton, Button } from '@/features/shared/components/buttons';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { ConfirmDialog } from '@/features/shared/components/feedback/ConfirmDialog';
import { useTranslation } from '@/i18n/useTranslation';
import type { ContestDetail } from '@/lib/bindings/ContestDetail';
import { toastCatch } from '@/lib/silentCatch';

import type { ReviewDraft } from '../hooks/useReviewDraft';
import { phaseLabel, phaseTone } from '../model/labels';
import { buildLanes, isLivePhase, makerSpec, raceStartMs, recordedBucket, relevantLayer, variantName, type Lane } from './arenaModel';
import { FinishLine } from './FinishLine';
import { SeatLabel } from './SeatLabel';
import { SeatLane } from './SeatLane';
import { ToneDot } from './ToneDot';

export interface RaceTrackProps {
  detail: ContestDetail;
  draft: ReviewDraft;
  onOpenVariant: (key: string) => void;
}

export function RaceTrack({ detail, draft, onOpenVariant }: RaceTrackProps) {
  const { t, tx } = useTranslation();
  const s = t.plugins.contest;
  const a = s.arena;
  const { summary } = detail;
  const { projectId, contestId, phase } = summary;
  const [confirmStop, setConfirmStop] = useState(false);
  const { racers, stewards } = buildLanes(detail);
  const bucketOf = (key: string) => recordedBucket(draft.review, summary, key);
  // The recorded verdict, named in the header (the roster alone carried it).
  const winnerVariant = summary.winner ? detail.variants.find((v) => v.key === summary.winner) ?? null : null;
  const winnerMaker = winnerVariant ? makerSpec(detail, winnerVariant) : summary.winnerSeatSpec;
  const firstVariant = detail.variants[0]?.key ?? null;
  const ceilingS = detail.timeoutMin > 0 ? detail.timeoutMin * 60 : null;
  const inReview = relevantLayer(phase) === 'review';
  const start = raceStartMs(detail);

  const renderLanes = (lanes: Lane[]) => (
    <ul className="divide-y divide-primary/[0.06]">
      {lanes.map((lane) => (
        <SeatLane
          key={`${lane.seat.kind}-${lane.seat.seatId}`}
          lane={lane}
          projectId={projectId}
          contestId={contestId}
          phase={phase}
          ceilingS={ceilingS}
          bucketOf={bucketOf}
          onOpenVariant={onOpenVariant}
        />
      ))}
    </ul>
  );

  return (
    <section className="space-y-5" aria-label={summary.title} data-testid="arena-track">
      <header className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1 space-y-0.5">
          <h3 className="typo-title-lg text-foreground line-clamp-2 break-words">{summary.title}</h3>
          <p className="flex flex-wrap items-center gap-x-1.5 typo-caption">
            <ToneDot tone={phaseTone(phase)} className="text-foreground">
              {phaseLabel(s, phase)}
            </ToneDot>
            {summary.round !== null && <span aria-hidden>·</span>}
            {summary.round !== null && <span>{tx(a.round_n, { n: summary.round })}</span>}
            <span aria-hidden>·</span>
            <span>{summary.projectName}</span>
            <span aria-hidden>·</span>
            <span className="break-all">{contestId}</span>
            {start && (
              <>
                <span aria-hidden>·</span>
                <span>
                  {start.upcoming ? a.starts : a.started}{' '}
                  <RelativeTime timestamp={start.ms} className="typo-caption" />
                </span>
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {phase === 'draft' && (
            <AsyncButton
              size="sm"
              variant="primary"
              icon={<Play className="w-3.5 h-3.5" />}
              onClick={() => launchContest(projectId, contestId, 'participant').catch(toastCatch('contest:arena-launch'))}
              data-testid="arena-launch"
            >
              {a.launch}
            </AsyncButton>
          )}
          {isLivePhase(phase) && (
            <Button
              size="sm"
              variant="accent"
              accentColor="rose"
              icon={<Square className="w-3 h-3" />}
              onClick={() => setConfirmStop(true)}
              data-testid="arena-cancel"
            >
              {a.cancel}
            </Button>
          )}
          {firstVariant && (
            <Button
              size="sm"
              variant={inReview ? 'primary' : 'secondary'}
              icon={<Camera className="w-3.5 h-3.5" />}
              onClick={() => onOpenVariant(firstVariant)}
              data-testid="arena-open-photo-finish"
            >
              {a.photo_finish}
            </Button>
          )}
        </div>
      </header>

      {summary.winner && (
        <p className="flex flex-wrap items-center gap-x-1.5 typo-body text-foreground" data-testid="arena-track-winner">
          <Trophy className="w-3.5 h-3.5 text-status-success" aria-hidden />
          <span className="typo-label">{a.winner}</span>
          <span className="typo-data">{summary.winner}</span>
          {winnerVariant && <span>· {variantName(winnerVariant)}</span>}
          {winnerMaker && (
            <>
              <span aria-hidden>·</span>
              <span className="typo-caption">{a.made_by}</span>
              <SeatLabel spec={winnerMaker} />
            </>
          )}
        </p>
      )}
      {!summary.winner && summary.shortlist.length > 0 && (
        <p className="flex flex-wrap items-center gap-x-1.5 typo-body text-foreground" data-testid="arena-track-shortlist">
          <span className="typo-label">{s.bucket_shortlist}</span>
          <span className="typo-data">{summary.shortlist.join(', ')}</span>
        </p>
      )}
      {inReview && <p className="typo-caption">{a.photo_finish_hint}</p>}

      <div className="space-y-1">
        <h4 className="typo-label">{a.lanes_label}</h4>
        {renderLanes(racers)}
      </div>
      {stewards.length > 0 && (
        <div className="space-y-1">
          <h4 className="typo-label">{a.stewards_label}</h4>
          {renderLanes(stewards)}
        </div>
      )}

      <FinishLine detail={detail} />

      {confirmStop && (
        <ConfirmDialog
          danger
          title={a.cancel_title}
          body={a.cancel_body}
          confirmLabel={a.cancel}
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
