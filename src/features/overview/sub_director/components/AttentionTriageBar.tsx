import { ShieldCheck } from 'lucide-react';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { useTranslation } from '@/i18n/useTranslation';
import { attentionCounts, ATTENTION_ORDER, FLAG_TONE, type AttentionFlag } from '../attention';
import { toneFill } from '../directorScore';
import type { DirectorRosterEntry } from '@/api/director';

/**
 * Portfolio attention-triage summary — the per-row attention flags rolled up
 * across the whole roster into one compact strip (N need-review · N low · …).
 * Shows the *shape* of attention at a glance so triage starts from the totals,
 * not by scanning rows. Sits in the coaching-table section header.
 */
export function AttentionTriageBar({ roster }: { roster: DirectorRosterEntry[] }) {
  const { t } = useTranslation();
  const counts = attentionCounts(roster, Date.now());
  const total = ATTENTION_ORDER.reduce((s, f) => s + counts[f], 0);

  const FLAG_LABEL: Record<AttentionFlag, string> = {
    needs_review: t.director.flag_new,
    low: t.director.flag_low,
    declining: t.director.flag_declining,
    stale: t.director.flag_stale,
  };

  if (total === 0) {
    return (
      <span className="inline-flex items-center gap-1.5 typo-caption text-foreground">
        <ShieldCheck className="w-3.5 h-3.5" style={{ color: 'var(--status-success)' }} />
        {t.director.all_clear}
      </span>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 normal-case tracking-normal">
      {ATTENTION_ORDER.filter((f) => counts[f] > 0).map((f) => (
        <span
          key={f}
          className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-pill typo-caption"
          style={{ color: FLAG_TONE[f], backgroundColor: toneFill(FLAG_TONE[f], 14) }}
        >
          {FLAG_LABEL[f]}
          <Numeric value={counts[f]} className="font-semibold tabular-nums" />
        </span>
      ))}
    </span>
  );
}
