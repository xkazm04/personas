import { useMemo, useState } from 'react';
import { X, ChevronRight, ListFilter } from 'lucide-react';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import { ScoreSparkline } from '../ScoreSparkline';
import { scoreTone, toneFill } from '../directorScore';
import { attentionFlags, attentionRank, primaryFlag, FLAG_TONE, type AttentionFlag } from '../attention';
import type { DirectorRosterEntry } from '@/api/director';

// Shared column template so the header and every row line up.
const ROW_GRID = 'grid grid-cols-[1.6fr_52px_60px_72px_1.4fr_auto_auto] items-center gap-3';

/**
 * The consolidated coaching table — Roster + Attention in one surface. Each
 * in-scope agent is a hover-lift row (left signal line tinted to its most-urgent
 * attention flag, else its score tone) showing score · trend · value · attention
 * tags · last review. Clicking a row opens the per-agent detail modal (the
 * Reviews surface). A lightweight "only needs attention" filter focuses triage.
 */
export function PersonaCoachingTable({
  roster,
  onSelect,
  onRemove,
}: {
  roster: DirectorRosterEntry[];
  onSelect: (entry: DirectorRosterEntry) => void;
  onRemove: (personaId: string) => void;
}) {
  const { t } = useTranslation();
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const now = Date.now();

  const FLAG_LABEL: Record<AttentionFlag, string> = {
    needs_review: t.director.flag_new,
    low: t.director.flag_low,
    declining: t.director.flag_declining,
    stale: t.director.flag_stale,
  };
  const FLAG_HINT: Record<AttentionFlag, string> = {
    needs_review: t.director.group_needs_review_hint,
    low: t.director.group_low_scores_hint,
    declining: t.director.group_declining_hint,
    stale: t.director.group_stale_hint,
  };

  const rows = useMemo(() => {
    const decorated = roster.map((r) => ({ r, flags: attentionFlags(r, now) }));
    const filtered = onlyFlagged ? decorated.filter((d) => d.flags.length > 0) : decorated;
    // Flagged first (by urgency), then by ascending score, then name.
    return filtered.sort((a, b) => {
      const ra = attentionRank(a.flags);
      const rb = attentionRank(b.flags);
      if (ra !== rb) return ra - rb;
      const sa = a.r.latestScore ?? 99;
      const sb = b.r.latestScore ?? 99;
      if (sa !== sb) return sa - sb;
      return a.r.name.localeCompare(b.r.name);
    });
  }, [roster, onlyFlagged, now]);

  const flaggedCount = useMemo(
    () => roster.filter((r) => attentionFlags(r, now).length > 0).length,
    [roster, now],
  );

  return (
    <div>
      {/* header row */}
      <div className={`${ROW_GRID} px-2.5 pb-2 typo-label uppercase tracking-wider text-foreground border-b border-primary/10`}>
        <span>{t.director.roster_col_agent}</span>
        <span className="text-center">{t.director.roster_col_score}</span>
        <span>{t.director.roster_col_trend}</span>
        <span className="text-right">{t.director.roster_col_value}</span>
        <span>{t.director.col_flags}</span>
        <span className="text-right">{t.director.roster_col_last}</span>
        <button
          type="button"
          onClick={() => setOnlyFlagged((v) => !v)}
          disabled={flaggedCount === 0}
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-pill normal-case tracking-normal transition-colors disabled:opacity-40 ${
            onlyFlagged ? 'bg-violet-500/15 text-violet-200 border border-violet-500/30' : 'text-foreground border border-transparent hover:bg-secondary/40'
          }`}
          title={t.director.only_flagged}
        >
          <ListFilter className="w-3 h-3" />
          <span className="tabular-nums">{flaggedCount}</span>
        </button>
      </div>

      <div className="mt-1 space-y-0.5">
        {rows.map(({ r, flags }, i) => {
          const tone = r.latestScore != null ? scoreTone(r.latestScore) : null;
          const pf = primaryFlag(flags);
          const accent = pf ? FLAG_TONE[pf] : tone?.color ?? 'var(--primary)';
          return (
            <div
              key={r.personaId}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(r)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(r); } }}
              className={`${ROW_GRID} row-hover-lift animate-fade-slide-in pl-2.5 pr-1.5 py-2 rounded cursor-pointer`}
              style={{ ['--row-accent' as string]: accent, animationDelay: `${Math.min(i, 12) * 25}ms` }}
            >
              {/* agent */}
              <span className="flex items-center gap-2 min-w-0">
                <PersonaIcon icon={r.icon} color={r.color} size="w-4 h-4" />
                <span className="typo-body text-foreground truncate">{r.name}</span>
              </span>
              {/* score */}
              <span className="text-center">
                {r.latestScore != null && tone ? (
                  <span
                    className="inline-flex items-center justify-center min-w-[1.5rem] px-1.5 py-0.5 rounded text-[11px] tabular-nums font-medium"
                    style={{ color: tone.color, backgroundColor: toneFill(tone.color, 14) }}
                  >
                    {r.latestScore}
                  </span>
                ) : (
                  <span className="typo-caption text-foreground">—</span>
                )}
              </span>
              {/* trend */}
              <span>
                {r.scoreTrend.length >= 2 ? (
                  <ScoreSparkline scores={r.scoreTrend} />
                ) : (
                  <span className="typo-caption text-foreground">—</span>
                )}
              </span>
              {/* value */}
              <span className="flex items-center justify-end gap-2">
                <span className="h-1.5 w-10 rounded-pill bg-secondary/60 overflow-hidden hidden lg:block">
                  <span className="block h-full rounded-pill" style={{ width: `${Math.round(r.valueDeliveredRate * 100)}%`, background: 'var(--status-success)' }} />
                </span>
                <Numeric value={r.valueDeliveredRate} unit="ratio" precision={0} className="typo-caption text-foreground tabular-nums" />
              </span>
              {/* attention tags */}
              <span className="flex flex-wrap items-center gap-1">
                {flags.length === 0 ? (
                  <span className="typo-caption text-foreground">—</span>
                ) : (
                  flags.map((f) => (
                    <Tooltip key={f} content={FLAG_HINT[f]}>
                      <span
                        className="px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide font-medium"
                        style={{ color: FLAG_TONE[f], backgroundColor: toneFill(FLAG_TONE[f], 14) }}
                      >
                        {FLAG_LABEL[f]}
                      </span>
                    </Tooltip>
                  ))
                )}
              </span>
              {/* last review */}
              <span className="text-right">
                {r.lastReviewedAt ? (
                  <RelativeTime timestamp={r.lastReviewedAt} className="typo-caption text-foreground" />
                ) : (
                  <span className="typo-caption text-foreground">{t.director.roster_never}</span>
                )}
              </span>
              {/* actions */}
              <span className="flex items-center justify-end gap-0.5">
                <Tooltip content={t.director.roster_remove}>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onRemove(r.personaId); }}
                    className="p-1 rounded text-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
                    aria-label={t.director.roster_remove}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </Tooltip>
                <ChevronRight className="w-3.5 h-3.5 text-foreground" />
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
