import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { SectionCard } from '@/features/shared/components/layout/SectionCard';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useTranslation } from '@/i18n/useTranslation';
import { tokenLabel } from '@/i18n/tokenMaps';
import type { UseDirector } from '../useDirector';

type SeverityFilter = 'all' | 'info' | 'warning' | 'error';

const SEVERITY_CHIP: Record<string, string> = {
  error: 'bg-red-500/15 text-red-400',
  warning: 'bg-amber-500/15 text-amber-400',
  info: 'bg-blue-500/15 text-blue-400',
};

/**
 * Full coaching history — every Director verdict, filterable by severity, each
 * row expandable to its rationale + suggested actions. Reads the same
 * `list_director_verdicts` feed the Overview previews; here it's unbounded.
 */
export function DirectorReviews({ d }: { d: UseDirector }) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<SeverityFilter>('all');
  const [expanded, setExpanded] = useState<string | null>(null);

  const filters: SeverityFilter[] = ['all', 'error', 'warning', 'info'];
  const rows = useMemo(
    () => (filter === 'all' ? d.verdicts : d.verdicts.filter((v) => v.severity === filter)),
    [d.verdicts, filter],
  );

  return (
    <div className="pb-6">
      <SectionCard
        title={t.director.reviews_title}
        size="sm"
      >
        {/* Severity filter */}
        <div className="flex items-center gap-1.5 mb-3">
          {filters.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`px-2 py-0.5 rounded-interactive typo-caption transition-colors ${
                filter === f
                  ? 'bg-violet-500/15 text-violet-300 border border-violet-500/30'
                  : 'text-foreground/55 border border-transparent hover:bg-secondary/40'
              }`}
            >
              {f === 'all' ? t.director.reviews_filter_all : tokenLabel(t, 'severity', f)}
            </button>
          ))}
        </div>

        {rows.length === 0 ? (
          <p className="typo-caption text-foreground/45 py-2">{t.director.reviews_empty}</p>
        ) : (
          <ul className="space-y-1">
            {rows.map((v) => {
              const open = expanded === v.reviewId;
              const Chevron = open ? ChevronDown : ChevronRight;
              return (
                <li key={v.reviewId} className="rounded border border-primary/5 bg-secondary/10">
                  <button
                    type="button"
                    onClick={() => setExpanded(open ? null : v.reviewId)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 text-left hover:bg-secondary/30 rounded transition-colors"
                  >
                    <Chevron className="w-3.5 h-3.5 text-foreground/40 shrink-0" />
                    <span className={`px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide shrink-0 ${SEVERITY_CHIP[v.severity] ?? SEVERITY_CHIP.info}`}>
                      {tokenLabel(t, 'severity', v.severity)}
                    </span>
                    <span className="typo-caption text-foreground/85 truncate flex-1">{v.title}</span>
                    <RelativeTime timestamp={v.createdAt} className="typo-caption text-foreground/45 shrink-0" />
                  </button>
                  {open && (
                    <div className="px-7 pb-3 pt-1 space-y-2">
                      {v.description && <p className="typo-caption text-foreground/75">{v.description}</p>}
                      {v.rationale && (
                        <p className="typo-caption text-foreground/55 italic border-l-2 border-primary/15 pl-2">{v.rationale}</p>
                      )}
                      {v.suggestedActions.length > 0 && (
                        <ul className="list-disc list-inside space-y-0.5">
                          {v.suggestedActions.map((a, i) => (
                            <li key={i} className="typo-caption text-foreground/70">{a}</li>
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
      </SectionCard>
    </div>
  );
}
