import { useCallback, useEffect, useState } from 'react';
import { FlaskConical, Coins } from 'lucide-react';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import {
  commissionDirectorExperiment,
  getDirectorCampaignReport,
  listDirectorExperiments,
  type DirectorCampaignReport,
  type DirectorHypothesis,
  type DirectorVerdictRow,
  type LabAbExperiment,
} from '@/api/director';
import { DirectorSection } from '../DirectorSection';

/**
 * Director's Lab — minimal campaign report (batch-3 v1). Three stacked bands:
 *
 * 1. Headline counts (hypotheses emitted / experiments by state) + the weekly
 *    budget ledger. A dry ledger is called out explicitly — the Director
 *    declines to commission until it resets, and says so.
 * 2. "Ready to compile": approved verdicts that carry a typed hypothesis but
 *    have no experiment yet — one action each (proposed, not imposed: only a
 *    human click compiles).
 * 3. Commissioned experiments with honest per-state badges, including
 *    `awaiting_variant` (registered, variant pending on the evolution
 *    surface) and `declined_budget` (visible refusal).
 *
 * Empty state is honest: no inference, no placeholder charts — just "nothing
 * commissioned yet" in Athena's first person.
 */
export function CampaignReportPanel({
  verdicts,
  playEntrance,
}: {
  verdicts: DirectorVerdictRow[];
  playEntrance?: boolean;
}) {
  const { t, tx } = useTranslation();
  const [report, setReport] = useState<DirectorCampaignReport | null>(null);
  const [experiments, setExperiments] = useState<LabAbExperiment[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [compilingId, setCompilingId] = useState<string | null>(null);

  const refresh = useCallback(() => {
    Promise.allSettled([getDirectorCampaignReport(), listDirectorExperiments()]).then(
      ([r, e]) => {
        if (r.status === 'fulfilled') setReport(r.value);
        if (e.status === 'fulfilled') setExperiments(e.value);
        setLoaded(true);
      },
    );
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Approved verdicts carrying a hypothesis, not yet compiled.
  const compiled = new Set(experiments.map((e) => e.reviewId).filter(Boolean));
  const pending = verdicts.filter(
    (v) => v.status === 'approved' && v.hypothesis != null && !compiled.has(v.reviewId),
  );

  const commission = async (reviewId: string) => {
    setCompilingId(reviewId);
    try {
      await commissionDirectorExperiment(reviewId);
    } catch (e) {
      silentCatch('CampaignReportPanel:commission')(e);
    } finally {
      setCompilingId(null);
      refresh();
    }
  };

  const ledger = report?.ledger ?? null;
  const isEmpty =
    loaded && (report?.experimentsTotal ?? 0) === 0 && pending.length === 0 &&
    (report?.hypothesesEmitted ?? 0) === 0;

  return (
    <DirectorSection
      label={t.director.lab_title}
      icon={FlaskConical}
      className={playEntrance ? 'animate-fade-in' : undefined}
      style={playEntrance ? { animationDelay: '140ms' } : undefined}
      action={
        ledger && (
          <span
            className="inline-flex items-center gap-1.5 typo-caption text-foreground tabular-nums"
            title={t.director.lab_ledger_title}
          >
            <Coins className="w-3.5 h-3.5 text-violet-300" />
            {tx(t.director.lab_ledger_summary, {
              spent: ledger.spentUsd.toFixed(2),
              budget: ledger.budgetUsd.toFixed(2),
            })}
          </span>
        )
      }
    >
      {!loaded ? (
        <div className="h-16 rounded-card bg-primary/[0.06] animate-pulse" aria-hidden />
      ) : isEmpty ? (
        <div className="py-6 text-center">
          <p className="typo-body text-foreground">{t.director.lab_empty_title}</p>
          <p className="typo-caption text-foreground mt-1 max-w-md mx-auto">
            {t.director.lab_empty_subtitle}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Headline counts */}
          <div className="flex items-center gap-4 flex-wrap typo-caption text-foreground">
            <CountChip label={t.director.lab_kpi_hypotheses} value={report?.hypothesesEmitted ?? 0} />
            <CountChip label={t.director.lab_kpi_experiments} value={report?.experimentsTotal ?? 0} />
            <CountChip label={t.director.lab_kpi_variant_ready} value={report?.variantReady ?? 0} />
            <CountChip label={t.director.lab_kpi_awaiting} value={report?.awaitingVariant ?? 0} />
            <CountChip label={t.director.lab_kpi_declined} value={report?.declinedBudget ?? 0} />
          </div>

          {/* Ledger bar + dry warning */}
          {ledger && ledger.budgetUsd > 0 && (
            <div>
              <div className="h-1.5 rounded-pill bg-secondary/60 overflow-hidden">
                <div
                  className="h-full rounded-pill"
                  style={{
                    width: `${Math.min(100, (ledger.spentUsd / ledger.budgetUsd) * 100)}%`,
                    background:
                      ledger.remainingUsd <= 0 ? 'var(--status-error)' : 'var(--status-success)',
                  }}
                />
              </div>
              {ledger.remainingUsd <= 0 && (
                <p className="typo-caption text-amber-400 mt-1.5">{t.director.lab_ledger_dry}</p>
              )}
            </div>
          )}

          {/* Ready to compile */}
          {pending.length > 0 && (
            <div>
              <p className="typo-caption uppercase tracking-wider text-foreground mb-1.5" title={t.director.lab_pending_hint}>
                {t.director.lab_pending_title}
              </p>
              <ul className="space-y-1.5">
                {pending.map((v) => (
                  <li
                    key={v.reviewId}
                    className="flex items-center justify-between gap-3 px-2.5 py-2 rounded-card border border-primary/10 bg-secondary/20"
                  >
                    <div className="min-w-0">
                      <p className="typo-caption text-foreground truncate">{v.title}</p>
                      <HypothesisLine hypothesis={v.hypothesis!} />
                    </div>
                    <AsyncButton
                      variant="accent"
                      accentColor="violet"
                      size="sm"
                      isLoading={compilingId === v.reviewId}
                      loadingText={t.director.lab_commissioning}
                      disabled={compilingId != null}
                      onClick={() => commission(v.reviewId)}
                      data-testid={`lab-commission-${v.reviewId}`}
                    >
                      {t.director.lab_commission}
                    </AsyncButton>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Commissioned experiments */}
          {experiments.length > 0 && (
            <div>
              <p className="typo-caption uppercase tracking-wider text-foreground mb-1.5">
                {t.director.lab_experiments_title}
              </p>
              <ul className="space-y-1.5">
                {experiments.map((e) => (
                  <ExperimentRow key={e.id} experiment={e} />
                ))}
              </ul>
              <p className="typo-caption text-foreground mt-2">{t.director.lab_deferred_note}</p>
            </div>
          )}
        </div>
      )}
    </DirectorSection>
  );
}

function CountChip({ label, value }: { label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {label}
      <Numeric value={value} className="text-foreground font-medium tabular-nums" />
    </span>
  );
}

function HypothesisLine({ hypothesis }: { hypothesis: DirectorHypothesis }) {
  const { t } = useTranslation();
  return (
    <p className="typo-caption text-foreground truncate" title={hypothesis.proposedChange}>
      {t.director.lab_hypothesis_change}: {hypothesis.proposedChange}
      {hypothesis.successMetric && (
        <span className="ml-2">
          {t.director.lab_hypothesis_metric}: {hypothesis.successMetric}
        </span>
      )}
    </p>
  );
}

function statusMeta(status: string): { labelKey: StatusLabelKey; className: string } {
  switch (status) {
    case 'variant_ready':
      return { labelKey: 'lab_status_variant_ready', className: 'text-emerald-400 border-emerald-400/30 bg-emerald-400/10' };
    case 'declined_budget':
      return { labelKey: 'lab_status_declined_budget', className: 'text-amber-400 border-amber-400/30 bg-amber-400/10' };
    case 'running':
      return { labelKey: 'lab_status_running', className: 'text-sky-400 border-sky-400/30 bg-sky-400/10' };
    case 'concluded':
      return { labelKey: 'lab_status_concluded', className: 'text-foreground border-primary/20 bg-secondary/40' };
    case 'awaiting_variant':
    default:
      return { labelKey: 'lab_status_awaiting_variant', className: 'text-violet-300 border-violet-400/30 bg-violet-400/10' };
  }
}

type StatusLabelKey =
  | 'lab_status_variant_ready'
  | 'lab_status_awaiting_variant'
  | 'lab_status_declined_budget'
  | 'lab_status_running'
  | 'lab_status_concluded';

function ExperimentRow({ experiment }: { experiment: LabAbExperiment }) {
  const { t } = useTranslation();
  const meta = statusMeta(experiment.status);
  let hypothesis: Partial<DirectorHypothesis> = {};
  try {
    hypothesis = JSON.parse(experiment.hypothesisJson) as Partial<DirectorHypothesis>;
  } catch (e) {
    // legacy/malformed rows render without the hypothesis line
    silentCatch('CampaignReportPanel:hypothesisJson')(e);
  }
  return (
    <li className="flex items-center justify-between gap-3 px-2.5 py-2 rounded-card border border-primary/10 bg-secondary/20">
      <div className="min-w-0">
        <p className="typo-caption text-foreground truncate" title={hypothesis.proposedChange ?? ''}>
          {hypothesis.proposedChange ?? experiment.id}
        </p>
        {experiment.statusDetail && (
          <p className="typo-caption text-foreground truncate" title={experiment.statusDetail}>
            {experiment.statusDetail}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {experiment.spendUsd > 0 && (
          <Numeric value={experiment.spendUsd} unit="usd" className="typo-caption text-foreground tabular-nums" />
        )}
        <span className={`typo-caption px-1.5 py-0.5 rounded-pill border ${meta.className}`}>
          {t.director[meta.labelKey]}
        </span>
        <RelativeTime timestamp={experiment.createdAt} className="typo-caption text-foreground" />
      </div>
    </li>
  );
}
