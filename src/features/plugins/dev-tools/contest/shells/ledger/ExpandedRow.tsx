// The detail layer: one ledger row opened in place. The full stage rail, the
// run's controls, the autopilot chain, the seats, the variants by seat, the
// judges' scoreboard, and the brief one click further down.
import { useState } from 'react';
import { ChevronDown, ChevronRight, Columns2, Play, Square } from 'lucide-react';

import { cancelContest, launchContest } from '@/api/contest';
import { AsyncButton, Button } from '@/features/shared/components/buttons';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { ErrorBanner } from '@/features/shared/components/feedback/ErrorBanner';
import { ConfirmDialog } from '@/features/shared/components/feedback/ConfirmDialog';
import { useTranslation } from '@/i18n/useTranslation';
import { resolveErrorTranslated } from '@/i18n/useTranslatedError';
import type { ContestDetail } from '@/lib/bindings/ContestDetail';
import { extractMessage, toastCatch } from '@/lib/silentCatch';

import { useContest } from '../../hooks/useContests';
import { LEDGER_COPY as C, fill } from './copy';
import { isLive, isReviewable, variantSeatSpec, variantsByLetter } from './model/ledgerFacts';
import type { LedgerRow } from './model/ledgerOrder';
import { ScoreboardTable } from './ScoreboardTable';
import { SeatLedger, ChainStrip } from './SeatLedger';
import { SeatSpecChips } from './SeatSpecChips';
import { StageRail } from './StageRail';

export interface ExpandedRowProps {
  row: LedgerRow;
  onOpenReview: () => void;
}

export function ExpandedRow({ row, onOpenReview }: ExpandedRowProps) {
  const { t, tx } = useTranslation();
  const { projectId, contestId } = row.summary;
  const { detail, isLoading, error, refresh } = useContest(projectId, contestId);

  if (error && !detail) {
    return (
      <ErrorBanner
        variant="inline"
        message={tx(t.plugins.contest.detail_load_failed, {
          message: resolveErrorTranslated(t, extractMessage(error)).message,
        })}
        onRetry={() => void refresh()}
      />
    );
  }
  if (!detail) return <ExpandedGhost label={isLoading ? C.detailLoading : ''} />;
  return <ExpandedBody detail={detail} onOpenReview={onOpenReview} />;
}

function ExpandedBody({ detail, onOpenReview }: { detail: ContestDetail; onOpenReview: () => void }) {
  const { t } = useTranslation();
  const s = t.plugins.contest;
  const { projectId, contestId, phase, winner } = detail.summary;
  const [briefOpen, setBriefOpen] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const winnerVariant = winner ? detail.variants.find((v) => v.key === winner) : undefined;
  const winnerSpec = winnerVariant ? variantSeatSpec(detail, winnerVariant) : detail.summary.winnerSeatSpec;

  return (
    <div className="space-y-4" data-testid={`ledger-expanded-${projectId}/${contestId}`}>
      <div className="flex flex-wrap items-start gap-4">
        <StageRail
          phase={phase}
          judgesEnabled={detail.judgesEnabled}
          chainStep={detail.chain.step}
          className="min-w-[20rem] flex-1"
        />
        <div className="flex flex-wrap gap-2">
          {phase === 'draft' && (
            <AsyncButton
              size="sm"
              variant="primary"
              icon={<Play className="h-3.5 w-3.5" />}
              onClick={() => launchContest(projectId, contestId, 'participant').catch(toastCatch('contest:launch'))}
              data-testid="ledger-launch"
            >
              {C.launch}
            </AsyncButton>
          )}
          {isLive(phase) && (
            <Button
              size="sm"
              variant="danger"
              icon={<Square className="h-3.5 w-3.5" />}
              onClick={() => setConfirmCancel(true)}
              data-testid="ledger-cancel"
            >
              {C.cancel}
            </Button>
          )}
          <Button
            size="sm"
            variant={isReviewable(phase) ? 'primary' : 'secondary'}
            icon={<Columns2 className="h-3.5 w-3.5" />}
            disabled={detail.variants.length === 0}
            disabledReason={detail.variants.length === 0 ? C.noVariants : undefined}
            onClick={onOpenReview}
            data-testid="ledger-open-review"
          >
            {C.openReview} <kbd className="ml-1 typo-code">{C.openReviewKey}</kbd>
          </Button>
        </div>
      </div>

      {winner && (
        <p className="flex flex-wrap items-center gap-2 typo-body text-foreground" data-testid="ledger-winner-line">
          <span className="typo-title">{fill(C.winnerFrom, { key: winner })}</span>
          {winnerSpec ? <SeatSpecChips spec={winnerSpec} /> : <span>—</span>}
          {detail.summary.round !== null && <span className="typo-caption">{fill(C.roundOf, { n: detail.summary.round, parent: detail.summary.parentId ?? '—' })}</span>}
        </p>
      )}

      <ChainStrip detail={detail} />
      <SeatLedger detail={detail} />
      <VariantIndex detail={detail} />
      {detail.scoreboard && <ScoreboardTable scoreboard={detail.scoreboard} />}

      <div className="space-y-2">
        <Button
          size="xs"
          variant="ghost"
          aria-expanded={briefOpen}
          icon={briefOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          onClick={() => setBriefOpen((v) => !v)}
        >
          {briefOpen ? C.briefHide : C.briefShow}
        </Button>
        {briefOpen && (
          <pre className="max-h-[24rem] overflow-auto whitespace-pre-wrap rounded-card border border-primary/10 bg-secondary/15 p-3 typo-code text-foreground">
            {detail.brief}
          </pre>
        )}
      </div>

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
    </div>
  );
}

/** Variants by seat letter: key, title, concept, size. */
function VariantIndex({ detail }: { detail: ContestDetail }) {
  const groups = variantsByLetter(detail.variants);
  return (
    <section aria-label={C.detailVariants} className="space-y-1.5" data-testid="ledger-variant-index">
      <h4 className="typo-label text-foreground">
        {C.detailVariants} · {fill(C.variantsCount, { count: detail.variants.length })}
      </h4>
      {groups.length === 0 ? (
        <p className="typo-caption text-foreground">{C.noVariants}</p>
      ) : (
        <ul className="grid gap-1.5 md:grid-cols-2">
          {groups.flatMap((g) =>
            g.variants.map((v) => (
              <li key={v.key} className="flex min-w-0 items-baseline gap-2 rounded-interactive bg-secondary/15 px-2 py-1">
                <span className="typo-data text-foreground">{v.key}</span>
                <span className="min-w-0 flex-1 truncate typo-caption text-foreground">
                  <span className="typo-title">{v.title || '—'}</span>
                  {v.concept ? ` · ${v.concept}` : ''}
                </span>
                <Numeric value={v.bytes} unit="compact" className="typo-caption text-foreground" />
              </li>
            )),
          )}
        </ul>
      )}
    </section>
  );
}

/** Calm, delayed ghost in the expanded row's geometry. */
function ExpandedGhost({ label }: { label: string }) {
  return (
    <div className="space-y-3" data-testid="ledger-expanded-ghost">
      <span className="sr-only" role="status">
        {label}
      </span>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          aria-hidden
          className="h-10 animate-fade-in rounded-card bg-primary/[0.06]"
          style={{ animationDelay: `${120 + i * 35}ms` }}
        />
      ))}
    </div>
  );
}
