// Library revision rail — the first UI reader of skill_revisions. Newest
// first; rows carrying a declared version get the version chip, hash-only
// revisions render as method-change ticks.
import { GitCommitVertical } from 'lucide-react';

import type { SkillRevisionRow } from '@/api/devTools/devTools';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useTranslation } from '@/i18n/useTranslation';

export function VersionTimelinePanel({ timeline, loading }: { timeline: SkillRevisionRow[]; loading: boolean }) {
  const { t } = useTranslation();
  return (
    <section className="rounded-card border border-border/50 bg-secondary/30 p-3">
      <h3 className="typo-card-label text-foreground pb-2">{t.plugins.dev_tools.trace_timeline_title}</h3>
      {loading && timeline.length === 0 ? (
        <div aria-hidden className="flex flex-col gap-1.5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-5 rounded-interactive bg-primary/[0.06] animate-fade-in" style={{ animationDelay: `${120 + i * 35}ms` }} />
          ))}
        </div>
      ) : timeline.length === 0 ? (
        <p className="typo-caption text-foreground">{t.plugins.dev_tools.trace_timeline_empty}</p>
      ) : (
        <ol className="flex flex-col gap-1">
          {timeline.map((r) => (
            <li key={r.rev} className="flex items-center gap-2 typo-caption [content-visibility:auto] [contain-intrinsic-size:auto_24px]">
              <GitCommitVertical size={13} className="text-foreground shrink-0" />
              <span className="text-foreground">#{r.rev}</span>
              {r.version != null ? (
                <span className="px-1.5 rounded-interactive bg-primary/10 text-primary">v{r.version}</span>
              ) : (
                <span className="text-foreground">{t.plugins.dev_tools.trace_timeline_method_change}</span>
              )}
              <RelativeTime timestamp={r.changed_at} className="text-foreground ml-auto" />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
