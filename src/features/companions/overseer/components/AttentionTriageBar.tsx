import { ShieldCheck } from 'lucide-react';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { useTranslation } from '@/i18n/useTranslation';
import { attentionCounts, ATTENTION_ORDER, FLAG_TONE, type AttentionFlag } from '../attention';
import { toneFill } from '../directorScore';
import { toggleFilter, type RosterFilter } from '../rosterFilter';
import type { DirectorRosterEntry } from '@/api/director';

/**
 * Portfolio attention-triage summary — the per-row attention flags rolled up
 * across the whole roster into one compact strip (N need-review · N low · …).
 * Shows the *shape* of attention at a glance so triage starts from the totals,
 * not by scanning rows. Each chip is a one-click filter on the coaching table
 * (re-click to clear); the active chip reads as pressed. Sits in the table
 * section header.
 */
export function AttentionTriageBar({
  roster,
  filter,
  onSelect,
}: {
  roster: DirectorRosterEntry[];
  filter: RosterFilter | null;
  onSelect: (filter: RosterFilter | null) => void;
}) {
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
      {ATTENTION_ORDER.filter((f) => counts[f] > 0).map((f) => {
        const active = filter?.type === 'flag' && filter.flag === f;
        return (
          <button
            key={f}
            type="button"
            onClick={() => onSelect(toggleFilter(filter, { type: 'flag', flag: f }))}
            aria-pressed={active}
            title={t.director.triage_chip_hint}
            className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-pill typo-caption transition-shadow focus-ring"
            style={{
              color: FLAG_TONE[f],
              backgroundColor: toneFill(FLAG_TONE[f], active ? 24 : 14),
              boxShadow: active ? `inset 0 0 0 1px ${FLAG_TONE[f]}` : undefined,
            }}
          >
            {FLAG_LABEL[f]}
            <Numeric value={counts[f]} className="font-semibold tabular-nums" />
          </button>
        );
      })}
    </span>
  );
}
