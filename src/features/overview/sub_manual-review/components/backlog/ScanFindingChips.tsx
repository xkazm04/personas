// scan-finding/1 on a backlog card: the stored score (with its breakdown in a
// Tooltip), the confidence, and the model's shadow verdict. Every chip renders
// itself away when its field is absent, except the score, which says
// "Unscored" - an unmeasured item is never shown as 0.
import { Gauge, Sparkles } from 'lucide-react';

import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import { formatNumeric } from '@/lib/utils/formatters';

import type { BacklogIdea } from './backlogModel';

const CHIP = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 typo-caption border';

/** The breakdown keys the contract names, in the order the formula reads them. */
const PART_KEYS = ['impact', 'confidence_w', 'effort_div', 'risk_factor', 'formula'] as const;

export function ScoreChip({ idea }: { idea: Pick<BacklogIdea, 'score' | 'scoreParts'> }) {
  const { t, language } = useTranslation();
  const r = t.overview.review;
  if (idea.score === null) {
    return (
      <Tooltip content={r.backlog_unscored_tip} placement="top">
        <span className={`${CHIP} text-foreground border-primary/15 bg-primary/5`}>
          {r.backlog_unscored}
        </span>
      </Tooltip>
    );
  }
  const labels: Record<(typeof PART_KEYS)[number], string> = {
    impact: r.backlog_score_part_impact,
    confidence_w: r.backlog_score_part_confidence_w,
    effort_div: r.backlog_score_part_effort_div,
    risk_factor: r.backlog_score_part_risk_factor,
    formula: r.backlog_score_part_formula,
  };
  const parts = idea.scoreParts;
  const breakdown = parts ? (
    <div className="flex flex-col gap-0.5">
      <span className="typo-label">{r.backlog_score_breakdown}</span>
      {PART_KEYS.filter((k) => parts[k] !== undefined).map((k) => {
        const v = parts[k];
        return (
          <span key={k} className="typo-caption tabular-nums">
            {labels[k]}: {typeof v === 'number' ? formatNumeric(v, 'plain', { language, precision: 3 }) : v}
          </span>
        );
      })}
    </div>
  ) : r.backlog_col_score;
  return (
    <Tooltip content={breakdown} placement="top">
      <span className={`${CHIP} text-status-info border-status-info/30 bg-status-info/10 tabular-nums`}>
        <Gauge className="w-3 h-3" aria-hidden />
        {formatNumeric(idea.score, 'plain', { language, precision: 1 })}
      </span>
    </Tooltip>
  );
}

export function ConfidenceChip({ confidence }: { confidence: string | null }) {
  const { t } = useTranslation();
  const r = t.overview.review;
  const label = {
    low: r.backlog_confidence_low,
    medium: r.backlog_confidence_medium,
    high: r.backlog_confidence_high,
  }[confidence ?? ''];
  if (!label) return null;
  return <span className={`${CHIP} text-foreground border-primary/20 bg-primary/5`}>{label}</span>;
}

export function PredictedChip({ verdict, why }: { verdict: string | null; why: string | null }) {
  const { t } = useTranslation();
  const r = t.overview.review;
  const cfg = {
    accept: { label: r.backlog_predicted_accept, cls: 'text-status-success border-status-success/30 bg-status-success/10' },
    reject: { label: r.backlog_predicted_reject, cls: 'text-status-error border-status-error/30 bg-status-error/10' },
    defer: { label: r.backlog_predicted_defer, cls: 'text-status-warning border-status-warning/30 bg-status-warning/10' },
  }[verdict ?? ''];
  if (!cfg) return null;
  const chip = (
    <span className={`${CHIP} ${cfg.cls}`}>
      <Sparkles className="w-3 h-3" aria-hidden />
      {cfg.label}
    </span>
  );
  return why ? <Tooltip content={why} placement="top">{chip}</Tooltip> : chip;
}

/** The three chips together, as a card header row carries them. */
export function ScanFindingChips({ idea }: { idea: BacklogIdea }) {
  return (
    <>
      <ScoreChip idea={idea} />
      <ConfidenceChip confidence={idea.confidence} />
      <PredictedChip verdict={idea.predictedVerdict} why={idea.predictedWhy} />
    </>
  );
}
