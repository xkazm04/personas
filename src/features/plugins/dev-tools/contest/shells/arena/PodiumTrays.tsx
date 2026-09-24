// The sort buckets as a podium and a pit lane. Winner and shortlist are the
// podium slots; failure is "disqualified" and impractical the other pit.
// Clicking a slot moves the variant on screen there; clicking a key in a slot
// brings that variant up. Extractable: a generic "tray board" over any
// bucket vocabulary.
import { Ban, Medal, Trophy, Wrench } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import type { ContestReviewBucket } from '@/lib/bindings/ContestReviewBucket';

import type { ReviewDraft } from '../../hooks/useReviewDraft';
import { bucketLabel } from '../../model/labels';
import { setBucket, variantReview } from '../../model/reviewModel';
import type { TrayId } from './arenaModel';
import { ARENA } from './copy';

const TRAY_ICON: Record<ContestReviewBucket, typeof Trophy> = {
  winner: Trophy,
  shortlist: Medal,
  impractical: Wrench,
  failure: Ban,
};

const TRAY_TONE: Record<ContestReviewBucket, string> = {
  winner: 'border-status-success/40 text-status-success',
  shortlist: 'border-status-info/40 text-status-info',
  impractical: 'border-status-warning/40 text-status-warning',
  failure: 'border-status-error/40 text-status-error',
};

export interface PodiumTraysProps {
  trays: Record<TrayId, string[]>;
  current: string | null;
  draft: ReviewDraft;
  onSelect: (key: string) => void;
}

export function PodiumTrays({ trays, current, draft, onSelect }: PodiumTraysProps) {
  const currentBucket = current && draft.review ? variantReview(draft.review, current).bucket : null;
  const move = (bucket: ContestReviewBucket) => {
    if (!current) return;
    draft.apply((r) => setBucket(r, current, currentBucket === bucket ? null : bucket));
  };
  const tray = (b: ContestReviewBucket) => (
    <Tray key={b} bucket={b} keys={trays[b]} current={current} active={currentBucket === b} onMove={() => move(b)} onSelect={onSelect} />
  );

  return (
    <div className="space-y-3" data-testid="arena-podium">
      <div className="space-y-1.5">
        <p className="typo-label text-foreground">{ARENA.podium}</p>
        <div className="grid grid-cols-2 gap-1.5">{(['winner', 'shortlist'] as const).map(tray)}</div>
      </div>
      <div className="space-y-1.5">
        <p className="typo-label text-foreground">{ARENA.pits}</p>
        <div className="grid grid-cols-2 gap-1.5">{(['failure', 'impractical'] as const).map(tray)}</div>
      </div>
      {trays.unsorted.length > 0 && (
        <div className="space-y-1">
          <p className="typo-label text-foreground">{ARENA.unsorted}</p>
          <KeyChips keys={trays.unsorted} current={current} onSelect={onSelect} />
        </div>
      )}
    </div>
  );
}

interface TrayProps {
  bucket: ContestReviewBucket;
  keys: string[];
  current: string | null;
  active: boolean;
  onMove: () => void;
  onSelect: (key: string) => void;
}

function Tray({ bucket, keys, current, active, onMove, onSelect }: TrayProps) {
  const { t } = useTranslation();
  const s = t.plugins.contest;
  const Icon = TRAY_ICON[bucket];
  return (
    <div className={`rounded-card border px-2 py-1.5 space-y-1 ${active ? 'bg-secondary/40' : 'bg-secondary/10'} ${TRAY_TONE[bucket]}`} data-testid={`arena-tray-${bucket}`}>
      <Button
        size="xs"
        variant="ghost"
        className="w-full justify-start"
        icon={<Icon className="w-3.5 h-3.5" />}
        aria-pressed={active}
        disabled={!current}
        onClick={onMove}
        data-testid={`arena-tray-move-${bucket}`}
      >
        {bucket === 'failure' ? `${bucketLabel(s, bucket)} · ${ARENA.disqualified}` : bucketLabel(s, bucket)}
      </Button>
      {keys.length > 0 ? <KeyChips keys={keys} current={current} onSelect={onSelect} /> : <p className="typo-caption text-foreground px-1">{ARENA.trayEmpty}</p>}
    </div>
  );
}

function KeyChips({ keys, current, onSelect }: { keys: string[]; current: string | null; onSelect: (key: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {keys.map((k) => (
        <Button key={k} size="xs" variant={k === current ? 'primary' : 'secondary'} aria-current={k === current ? 'true' : undefined} onClick={() => onSelect(k)}>
          {k}
        </Button>
      ))}
    </div>
  );
}
