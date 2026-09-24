// The review layer: a split pane over one contest. Left, the variant list;
// right, the live frame (pin mode on `p`) and the review sheet; below, the
// whole-field note, the decision and — when judges ran — the scoreboard.
// Keys: j/k variant, 1-4 tray, 0 unsort, p pin mode, Esc back.
import { useCallback, useState } from 'react';
import { ArrowLeft } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { StatusBadge } from '@/features/shared/components/display/StatusBadge';
import { ErrorBanner } from '@/features/shared/components/feedback/ErrorBanner';
import { useTranslation } from '@/i18n/useTranslation';
import { resolveErrorTranslated } from '@/i18n/useTranslatedError';
import type { ContestDetail } from '@/lib/bindings/ContestDetail';
import { extractMessage } from '@/lib/silentCatch';

import { DecisionBar } from '../../components/DecisionBar';
import { FieldNoteEditor, ReviewSheet, SaveState } from '../../components/ReviewSheet';
import { VariantFrame } from '../../components/VariantFrame';
import type { ContestKey } from '../../focus';
import { useContest } from '../../hooks/useContests';
import { useReviewDraft } from '../../hooks/useReviewDraft';
import { bucketLabel, bucketTone } from '../../model/labels';
import { REVIEW_BUCKETS, addPin, bucketCounts, setBucket, variantReview } from '../../model/reviewModel';
import { LEDGER_COPY as C, fill } from './copy';
import { moveCursor, type LedgerCommand } from './model/ledgerKeys';
import { ReviewVariantList } from './ReviewVariantList';
import { ScoreboardTable } from './ScoreboardTable';
import { useLedgerKeys } from './useLedgerKeys';

export interface ReviewSplitProps {
  contest: ContestKey;
  onBack: () => void;
}

export function ReviewSplit({ contest, onBack }: ReviewSplitProps) {
  const { t, tx } = useTranslation();
  const { detail, error, refresh } = useContest(contest.projectId, contest.contestId);
  if (error && !detail) {
    return (
      <ErrorBanner
        variant="inline"
        message={tx(t.plugins.contest.detail_load_failed, {
          message: resolveErrorTranslated(t, extractMessage(error)).message,
        })}
        onRetry={() => void refresh()}
        onBack={onBack}
      />
    );
  }
  if (!detail) {
    return (
      <div
        aria-hidden
        className="h-[28rem] animate-fade-in rounded-card bg-primary/[0.06]"
        style={{ animationDelay: '120ms' }}
        data-testid="ledger-review-ghost"
      />
    );
  }
  return <ReviewBody detail={detail} onBack={onBack} />;
}

function ReviewBody({ detail, onBack }: { detail: ContestDetail; onBack: () => void }) {
  const { t } = useTranslation();
  const s = t.plugins.contest;
  const draft = useReviewDraft(detail);
  const [activeIndex, setActiveIndex] = useState(0);
  const [pinMode, setPinMode] = useState(false);
  const count = detail.variants.length;
  const index = Math.min(activeIndex, Math.max(0, count - 1));
  const active = detail.variants[index] ?? null;
  const apply = draft.apply;

  const onCommand = useCallback(
    (cmd: LedgerCommand) => {
      if (cmd.kind === 'back') {
        if (pinMode) setPinMode(false);
        else onBack();
      } else if (cmd.kind === 'move') {
        setActiveIndex(moveCursor(index, cmd.by, count));
        setPinMode(false);
      } else if (cmd.kind === 'bucket' && active) {
        const key = active.key;
        apply((r) => setBucket(r, key, cmd.bucket));
      } else if (cmd.kind === 'pin-mode' && active?.previewUrl) {
        setPinMode((v) => !v);
      }
    },
    [pinMode, onBack, index, count, active, apply],
  );
  useLedgerKeys('review', onCommand);

  const counts = draft.review ? bucketCounts(draft.review) : null;
  const pins = active && draft.review ? variantReview(draft.review, active.key).pins : [];

  return (
    <section
      aria-label={fill(C.reviewTitle, { title: detail.summary.title })}
      className="space-y-4"
      data-testid="ledger-review"
    >
      <header className="flex flex-wrap items-center gap-2 border-b border-primary/10 pb-3">
        <Button size="sm" variant="ghost" icon={<ArrowLeft className="h-3.5 w-3.5" />} onClick={onBack} data-testid="ledger-review-back">
          {C.reviewBack}
        </Button>
        <h3 className="typo-heading">{fill(C.reviewTitle, { title: detail.summary.title })}</h3>
        <span className="typo-code text-foreground">{detail.summary.contestId}</span>
        {counts && (
          <span className="flex flex-wrap gap-1">
            {REVIEW_BUCKETS.map((b) => (
              <StatusBadge key={b} variant={counts[b] > 0 ? bucketTone(b) : 'neutral'} size="sm" pill>
                {bucketLabel(s, b)} {counts[b]}
              </StatusBadge>
            ))}
          </span>
        )}
        <span className="ml-auto">
          <SaveState draft={draft} />
        </span>
        <p className="w-full typo-caption text-foreground">{C.reviewKeys}</p>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(16rem,20rem)_1fr]">
        <ReviewVariantList
          detail={detail}
          review={draft.review}
          activeIndex={index}
          onActivate={(i) => {
            setActiveIndex(i);
            setPinMode(false);
          }}
        />
        {active ? (
          <div className="min-w-0 space-y-4">
            <VariantFrame
              variant={active}
              pins={pins}
              pinMode={pinMode}
              onPinModeChange={setPinMode}
              onAddPin={(pin) => apply((r) => addPin(r, active.key, pin))}
            />
            <ReviewSheet variant={active} draft={draft} />
          </div>
        ) : (
          <p className="typo-caption text-foreground">{C.reviewNoVariant}</p>
        )}
      </div>

      <div className="space-y-3 border-t border-primary/10 pt-3">
        <FieldNoteEditor draft={draft} />
        <DecisionBar detail={detail} draft={draft} onDecided={onBack} />
      </div>
      {detail.scoreboard && (
        <ScoreboardTable
          scoreboard={detail.scoreboard}
          activeKey={active?.key ?? null}
          onSelect={(key) => {
            const i = detail.variants.findIndex((v) => v.key === key);
            if (i >= 0) setActiveIndex(i);
          }}
        />
      )}
    </section>
  );
}
