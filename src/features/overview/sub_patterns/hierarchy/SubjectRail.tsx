// Left rail of the Subjects master–detail: 8 category groups in compass
// `order`, each a header over dense subject rows. Search filters live; a
// technique/application hit surfaces its parent subject with a "matched in…"
// hint. Ghost rows under the headers only while loading with no graph yet
// (loading law 2 — chrome always, ghost under it, content never held).
import { useCallback, type KeyboardEvent } from 'react';
import { AlertTriangle } from 'lucide-react';

import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import type { SubjectScore } from '@/lib/bindings/SubjectScore';

import { HierarchyStatusChip } from './HierarchyStatusChip';
import type { CategoryGroup, SubjectMatchInfo } from './hierarchyModel';

/** Calm geometry-matched ghost rows for a cold first load. */
function RailGhost() {
  return (
    <div aria-hidden="true" className="space-y-4 p-3 animate-fade-in" style={{ animationDelay: '150ms' }}>
      {[0, 1, 2].map((g) => (
        <div key={g} className="space-y-2">
          <div className="h-3 w-28 rounded-interactive bg-secondary/60" />
          {[0, 1, 2, 3].map((r) => (
            <div key={r} className="h-9 rounded-interactive bg-secondary/40" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function SubjectRail({
  groups,
  selectedSlug,
  onSelect,
  matchMap,
  loading,
  adherence = null,
}: {
  groups: CategoryGroup[];
  selectedSlug: string | null;
  onSelect: (slug: string) => void;
  /** Null when no search is active; otherwise subjects absent from the map
   *  are hidden and child hits carry a "matched in …" hint. */
  matchMap: Map<string, SubjectMatchInfo> | null;
  loading: boolean;
  /** Census adherence by slug — OPTIONAL. Subjects absent from the map (or a
   *  `null` map) show no badge: absence means no census rules, not cleanliness. */
  adherence?: ReadonlyMap<string, SubjectScore> | null;
}) {
  const { t, tx } = useTranslation();
  const p = t.overview.patterns_v2;

  const visibleGroups = matchMap
    ? groups
        .map((g) => ({ ...g, subjects: g.subjects.filter((s) => matchMap.has(s.slug)) }))
        .filter((g) => g.subjects.length > 0)
    : groups;

  const flat = visibleGroups.flatMap((g) => g.subjects.map((s) => s.slug));

  // Simple sequential ArrowUp/Down across the flattened visible rows.
  const onRowKeyDown = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>, slug: string) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const idx = flat.indexOf(slug);
      const next = flat[idx + (e.key === 'ArrowDown' ? 1 : -1)];
      if (next) {
        onSelect(next);
        const el = document.querySelector<HTMLButtonElement>(`[data-subject-row="${next}"]`);
        el?.focus();
      }
    },
    [flat, onSelect],
  );

  if (loading && groups.length === 0) {
    return (
      <div className="w-[320px] flex-shrink-0 border-r border-border/40 overflow-y-auto">
        <RailGhost />
      </div>
    );
  }

  return (
    <div className="w-[320px] flex-shrink-0 border-r border-border/40 overflow-y-auto">
      {visibleGroups.length === 0 && matchMap && (
        <p className="typo-body text-foreground p-4">{p.search_no_matches}</p>
      )}
      {visibleGroups.map((group) => (
        <div key={group.id ?? '__unassigned'} className="py-2">
          <div className="flex items-baseline justify-between px-3 py-1.5">
            {/* muted-ok: structural group header (category band), not body copy */}
            <h3 className="typo-label uppercase tracking-wide text-foreground/50">
              {group.id === null ? p.category_unassigned : group.title}
            </h3>
            {/* muted-ok: group-band count, structural micro-label */}
            <span className="typo-caption text-muted-foreground">{group.subjects.length}</span>
          </div>
          <ul className="space-y-0.5 px-1.5">
            {group.subjects.map((subject) => {
              const active = subject.slug === selectedSlug;
              const info = matchMap?.get(subject.slug);
              const techniqueCount = subject.techniques.length + subject.sharedTechniques.length;
              return (
                <li key={subject.slug}>
                  <button
                    type="button"
                    data-subject-row={subject.slug}
                    onClick={() => onSelect(subject.slug)}
                    onKeyDown={(e) => onRowKeyDown(e, subject.slug)}
                    aria-current={active ? 'true' : undefined}
                    className={`w-full text-left rounded-interactive px-2 py-1.5 transition-colors ${
                      active
                        ? 'bg-primary/10 text-foreground shadow-elevation-1'
                        : 'text-foreground/80 hover:bg-secondary/50 hover:text-foreground'
                    }`}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="typo-body truncate flex-1">{subject.title}</span>
                      <HierarchyStatusChip status={subject.status} />
                    </span>
                    <span className="flex items-center gap-2 mt-0.5">
                      {/* muted-ok: per-row counts micro-label, structural chrome */}
                      <span className="typo-caption text-muted-foreground">
                        {tx(p.rail_counts, {
                          techniques: techniqueCount,
                          applications: subject.applications.length,
                        })}
                      </span>
                      {subject.deviations.length > 0 && (
                        <span className="inline-flex items-center gap-1 typo-caption text-status-warning">
                          <AlertTriangle className="w-3 h-3" aria-hidden />
                          {subject.deviations.length}
                        </span>
                      )}
                      {/* Census site badge — quieter than the deviation badge:
                          muted, right-aligned, count only. Absent when the
                          scorecard carries no rules for this subject. */}
                      {(() => {
                        const score = adherence?.get(subject.slug);
                        if (!score || score.sites <= 0) return null;
                        return (
                          <Tooltip
                            content={tx(p.adherence_predicate, {
                              clean: score.cleanContexts,
                              applicable: score.applicableContexts,
                              sites: score.sites,
                            })}
                          >
                            {/* muted-ok: census-count micro-badge, structural chrome */}
                            <span className="ml-auto typo-caption text-muted-foreground tabular-nums flex-shrink-0">
                              {score.sites}
                            </span>
                          </Tooltip>
                        );
                      })()}
                    </span>
                    {info && !info.direct && info.childHint && (
                      <span className="block typo-caption text-primary/70 truncate mt-0.5">
                        {tx(p.rail_matched_in, { label: info.childHint })}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
