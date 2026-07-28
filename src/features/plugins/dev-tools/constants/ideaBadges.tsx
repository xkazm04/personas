/**
 * Idea scoring badges — shared by the Task Runner, backlog manual-review and
 * triage surfaces (formerly exported from the retired Idea Scanner's cards).
 *
 *  - LevelBadge      — effort/impact/risk numeric badge
 *  - ValueBadge      — synthesises effort/impact/risk into one verdict
 *  - ideaValueScore  — the shared scorer (drives triage queue ordering)
 */
import { TrendingUp } from 'lucide-react';

import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';

import { levelColor, levelSeverity } from './ideaColors';

export function LevelBadge({ label, value }: { label: string; value: number }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 typo-caption font-medium border ${levelColor(value)}`}>
      {label}: {value}
      <span className="opacity-70">· {levelSeverity(value)}</span>
    </span>
  );
}

/** Reward impact, charge for effort + risk. */
export function ideaValueScore(i: { impact: number; effort: number; risk: number }): number {
  return i.impact * 2 - i.effort - i.risk;
}

function valueTier(score: number): 'high' | 'med' | 'low' {
  if (score >= 8) return 'high';
  if (score >= 1) return 'med';
  return 'low';
}

export function ValueBadge({ idea }: { idea: { impact: number; effort: number; risk: number } }) {
  const { t } = useTranslation();
  const d = t.plugins.dev_tools;
  const tier = valueTier(ideaValueScore(idea));
  const cfg = {
    high: { cls: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10', label: d.idea_value_high },
    med: { cls: 'text-amber-400 border-amber-500/30 bg-amber-500/10', label: d.idea_value_med },
    low: { cls: 'text-foreground border-primary/20 bg-primary/5', label: d.idea_value_low },
  }[tier];
  return (
    <Tooltip content={d.idea_value_tip} placement="top">
      <span
        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 typo-caption font-medium border ${cfg.cls}`}
      >
        <TrendingUp className="w-3 h-3" />
        {cfg.label}
      </span>
    </Tooltip>
  );
}
