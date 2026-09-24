// The stage holds the race on the track: it loads the contest, owns its ONE
// review draft (shared by the lane tiles and the photo finish) and shows the
// lightbox on top when a variant is open. Loading v2: a lane-shaped ghost
// while cold, the error in place, never a spinner.
import { Flag, Plus } from 'lucide-react';

import EmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { ErrorBanner } from '@/features/shared/components/feedback/ErrorBanner';
import { useTranslation } from '@/i18n/useTranslation';
import { resolveErrorTranslated } from '@/i18n/useTranslatedError';
import { extractMessage } from '@/lib/silentCatch';

import type { ContestKey } from '../focus';
import { useContest } from '../hooks/useContests';
import { useReviewDraft } from '../hooks/useReviewDraft';
import { ARENA } from './copy';
import { PhotoFinish } from './PhotoFinish';
import { RaceTrack } from './RaceTrack';

export interface ArenaStageProps {
  trackKey: ContestKey | null;
  reviewKey: string | null;
  onReviewKey: (key: string | null) => void;
  onNewRace: () => void;
}

export function ArenaStage({ trackKey, reviewKey, onReviewKey, onNewRace }: ArenaStageProps) {
  const { t } = useTranslation();
  const { detail, isLoading, error, refresh } = useContest(trackKey?.projectId ?? null, trackKey?.contestId ?? null);
  const draft = useReviewDraft(detail);

  if (!trackKey) {
    return (
      <EmptyState icon={Flag} title={ARENA.trackEmptyTitle} subtitle={ARENA.trackEmptyBody} action={{ label: ARENA.newRace, onClick: onNewRace, icon: Plus }} />
    );
  }
  if (!detail) {
    if (error != null) {
      return (
        <ErrorBanner
          variant="inline"
          message={`${ARENA.trackLoadFailed} ${resolveErrorTranslated(t, extractMessage(error)).message}`}
          onRetry={() => void refresh()}
        />
      );
    }
    return isLoading ? <TrackGhost /> : null;
  }

  return (
    <>
      <RaceTrack detail={detail} draft={draft} onOpenVariant={onReviewKey} />
      {reviewKey && detail.variants.length > 0 && (
        <PhotoFinish detail={detail} draft={draft} currentKey={reviewKey} onSelect={onReviewKey} onClose={() => onReviewKey(null)} />
      )}
    </>
  );
}

/** Header band + three lane-shaped rows, invisible for the first 120 ms. */
function TrackGhost() {
  const bar = 'rounded-interactive bg-primary/[0.06]';
  return (
    <div className="space-y-4" aria-hidden data-testid="arena-track-ghost">
      <div className={`h-6 w-64 ${bar} animate-fade-in`} style={{ animationDelay: '120ms' }} />
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="grid grid-cols-[14rem_1fr_8rem] items-center gap-3 rounded-card border border-primary/[0.06] px-3 py-3 animate-fade-in"
          style={{ animationDelay: `${155 + i * 35}ms` }}
        >
          <div className={`h-4 ${bar}`} />
          <div className="h-px border-t border-dashed border-primary/10" />
          <div className={`h-4 ${bar}`} />
        </div>
      ))}
    </div>
  );
}
