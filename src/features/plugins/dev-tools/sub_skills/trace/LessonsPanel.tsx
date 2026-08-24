// Flat recent-lessons list under the tree — every LESSONS.md entry for this
// skill across the workspace (branch sprouts show the same data in-graph;
// this panel is the readable form).
import { useMemo } from 'react';

import { BookOpenText } from 'lucide-react';

import type { SkillLessonRow } from '@/api/devTools/devTools';
import { useTranslation } from '@/i18n/useTranslation';

import type { TreeBranch } from './traceTypes';

export function LessonsPanel({ branches, workspaceLessons, loading }: {
  branches: TreeBranch[];
  workspaceLessons: SkillLessonRow[];
  loading: boolean;
}) {
  const { t } = useTranslation();
  // Derived once per data change, not per render (hover on the tree above
  // re-renders this panel's parent).
  const all = useMemo<Array<{ origin: string; row: SkillLessonRow }>>(() => [
    ...branches.flatMap((b) => b.lessons.map((row) => ({ origin: b.project.name, row }))),
    ...workspaceLessons.map((row) => ({ origin: t.plugins.dev_tools.trace_core_library, row })),
  ].sort((a, b) => (b.row.date ?? '').localeCompare(a.row.date ?? '')), [branches, workspaceLessons, t]);

  return (
    <section className="rounded-card border border-border/50 bg-secondary/30 p-3">
      <h3 className="typo-card-label text-foreground pb-2">{t.plugins.dev_tools.trace_lessons_title}</h3>
      {loading && all.length === 0 ? (
        <div aria-hidden className="flex flex-col gap-1.5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-5 rounded-interactive bg-primary/[0.06] animate-fade-in" style={{ animationDelay: `${120 + i * 35}ms` }} />
          ))}
        </div>
      ) : all.length === 0 ? (
        <p className="typo-caption text-foreground">{t.plugins.dev_tools.trace_lessons_empty}</p>
      ) : (
        <ul className="flex flex-col gap-2 max-h-56 overflow-auto">
          {all.map(({ origin, row }, i) => (
            // content-visibility: offscreen lesson bodies (multi-line prose)
            // cost no layout inside the scroll clip (ScheduleRow precedent).
            <li key={i} className="flex gap-2 [content-visibility:auto] [contain-intrinsic-size:auto_44px]">
              <BookOpenText size={13} className={`shrink-0 mt-0.5 ${row.is_redesign ? 'text-status-warning' : 'text-status-success'}`} />
              <div className="min-w-0">
                <div className="typo-caption text-foreground">
                  {origin} · {row.date ?? ''} · v{row.version ?? '1.0'}
                  {row.is_redesign ? ` · ${t.plugins.dev_tools.trace_redesign_flag}` : ''}
                </div>
                <div className="typo-body whitespace-pre-line break-words">{row.lesson}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
