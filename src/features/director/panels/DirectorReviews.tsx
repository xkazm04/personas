import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, MessageSquareText } from 'lucide-react';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useTranslation } from '@/i18n/useTranslation';
import { tokenLabel } from '@/i18n/tokenMaps';
import { DirectorSection } from '../DirectorSection';
import type { UseDirector } from '../useDirector';

type SeverityFilter = 'all' | 'info' | 'warning' | 'error';

const SEVERITY_LINE: Record<string, string> = {
  error: 'var(--status-error)',
  warning: 'var(--status-warning)',
  info: 'var(--status-info)',
};
const SEVERITY_CHIP: Record<string, string> = {
  error: 'bg-red-500/15 text-red-400',
  warning: 'bg-amber-500/15 text-amber-400',
  info: 'bg-blue-500/15 text-blue-400',
};

/**
 * Full coaching history — every Director verdict, filterable by severity, each
 * a card with a severity-tinted left signal rail that expands to its rationale
 * + suggested actions. Reads the same `list_director_verdicts` feed the
 * Overview previews; here it's unbounded.
 */
export function DirectorReviews({ d }: { d: UseDirector }) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<SeverityFilter>('all');
  const [expanded, setExpanded] = useState<string | null>(null);

  const filters: SeverityFilter[] = ['all', 'error', 'warning', 'info'];
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: d.verdicts.length, error: 0, warning: 0, info: 0 };
    for (const v of d.verdicts) c[v.severity] = (c[v.severity] ?? 0) + 1;
    return c;
  }, [d.verdicts]);
  const rows = useMemo(
    () => (filter === 'all' ? d.verdicts : d.verdicts.filter((v) => v.severity === filter)),
    [d.verdicts, filter],
  );

  return (
    <div className="pb-6">
      <DirectorSection
        label={t.director.reviews_title}
        icon={MessageSquareText}
        action={
          <div className="flex items-center gap-1">
            {filters.map((f) => {
              const active = filter === f;
              return (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-pill typo-caption transition-colors ${
                    active
                      ? 'bg-violet-500/15 text-violet-200 border border-violet-500/30'
                      : 'text-foreground/55 border border-transparent hover:bg-secondary/40'
                  }`}
                >
                  {f === 'all' ? t.director.reviews_filter_all : tokenLabel(t, 'severity', f)}
                  <span className={`tabular-nums ${active ? 'text-violet-300/80' : 'text-foreground/35'}`}>{counts[f] ?? 0}</span>
                </button>
              );
            })}
          </div>
        }
      >
        {rows.length === 0 ? (
          <p className="typo-caption text-foreground/45 py-2">{t.director.reviews_empty}</p>
        ) : (
          <ul className="space-y-1.5">
            {rows.map((v, i) => {
              const open = expanded === v.reviewId;
              const Chevron = open ? ChevronDown : ChevronRight;
              const line = SEVERITY_LINE[v.severity] ?? SEVERITY_LINE.info;
              return (
                <li
                  key={v.reviewId}
                  className="relative overflow-hidden rounded-card border border-primary/10 bg-secondary/15 animate-fade-slide-in"
                  style={{ animationDelay: `${Math.min(i, 14) * 25}ms` }}
                >
                  {/* severity signal rail */}
                  <span aria-hidden className="absolute inset-y-0 left-0 w-0.5" style={{ background: line }} />
                  <button
                    type="button"
                    onClick={() => setExpanded(open ? null : v.reviewId)}
                    className="w-full flex items-center gap-2 pl-3 pr-2.5 py-2 text-left hover:bg-secondary/30 transition-colors"
                  >
                    <Chevron className="w-3.5 h-3.5 text-foreground/40 shrink-0" />
                    <span className={`px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide shrink-0 ${SEVERITY_CHIP[v.severity] ?? SEVERITY_CHIP.info}`}>
                      {tokenLabel(t, 'severity', v.severity)}
                    </span>
                    <span className="typo-caption text-foreground/90 truncate flex-1">{v.title}</span>
                    <RelativeTime timestamp={v.createdAt} className="typo-caption text-foreground/45 shrink-0" />
                  </button>
                  {open && (
                    <div className="pl-8 pr-4 pb-3 pt-0.5 space-y-2 animate-fade-slide-in">
                      {v.description && <p className="typo-caption text-foreground/75">{v.description}</p>}
                      {v.rationale && (
                        <p className="typo-caption text-foreground/55 italic border-l-2 border-primary/15 pl-2">{v.rationale}</p>
                      )}
                      {v.suggestedActions.length > 0 && (
                        <ul className="space-y-1">
                          {v.suggestedActions.map((a, j) => (
                            <li key={j} className="flex items-start gap-1.5 typo-caption text-foreground/70">
                              <span className="mt-1 w-1 h-1 rounded-full bg-violet-400/70 shrink-0" />
                              {a}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </DirectorSection>
    </div>
  );
}
