/**
 * Roadmap timeline view — the unique "as-is" UI for the special `roadmap`
 * release entry. Visual is unchanged from the legacy `HomeRoadmap` component;
 * the only difference is that items are now sourced from `releases.json`
 * (structure) + `src/i18n/en.ts` → `releases.whats_new.*` (titles +
 * descriptions + labels) so one config drives both the changelog tabs and
 * this view.
 *
 * Per project convention, no English strings live in this file directly —
 * status labels, priority labels, and the summary pill counts are all
 * looked up from `useReleasesTranslation` (backed by the main i18n system).
 * See `.claude/CLAUDE.md` → "Internationalization".
 */
import type { Release, ReleaseItem, ReleaseItemPriority, ReleaseItemStatus } from '@/data/releases';
import { useReleasesTranslation } from './i18n/useReleasesTranslation';
import type { ReleasesTranslation } from './i18n/useReleasesTranslation';

interface RoadmapDisplayItem {
  id: string;
  title: string;
  description: string;
  status: ReleaseItemStatus;
  priority: ReleaseItemPriority;
  sort_order: number;
}

const statusVisual: Record<ReleaseItemStatus, { dotColor: string; badgeBg: string; badgeText: string }> = {
  in_progress: {
    dotColor: 'bg-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.6)]',
    badgeBg: 'bg-cyan-500/10 border-cyan-500/20',
    badgeText: 'text-cyan-400',
  },
  planned: {
    dotColor: 'bg-foreground/30',
    badgeBg: 'bg-secondary/50 border-primary/10',
    badgeText: 'text-foreground',
  },
  completed: {
    dotColor: 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]',
    badgeBg: 'bg-emerald-500/10 border-emerald-500/20',
    badgeText: 'text-emerald-400',
  },
};

const priorityVisual: Record<ReleaseItemPriority, string> = {
  now: 'bg-cyan-500/10 border-cyan-500/20 text-cyan-400',
  next: 'bg-purple-500/10 border-purple-500/20 text-purple-400',
  later: 'bg-secondary/50 border-primary/10 text-foreground',
};

/**
 * Convert a release item from the JSON config + matched i18n entry into the
 * shape this view needs. Items missing roadmap-specific fields fall back to
 * safe defaults so a misconfigured entry never crashes the timeline.
 */
function toDisplayItem(
  item: ReleaseItem,
  fallbackOrder: number,
  i18nItems: Record<string, { title: string; description: string }> | undefined,
): RoadmapDisplayItem {
  const i18nEntry = i18nItems?.[item.id];
  return {
    id: item.id,
    title: i18nEntry?.title ?? `[roadmap.${item.id}]`,
    description: i18nEntry?.description ?? '',
    status: item.status ?? 'planned',
    priority: item.priority ?? 'later',
    sort_order: item.sort_order ?? fallbackOrder,
  };
}

/** Format an interpolated string like `"{count} In Progress"`. */
function format(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ''));
}

function RoadmapCard({
  item,
  index,
  total,
  t,
}: {
  item: RoadmapDisplayItem;
  index: number;
  total: number;
  t: ReleasesTranslation;
}) {
  const visual = statusVisual[item.status];
  const priorityClass = priorityVisual[item.priority];
  const statusLabel = t.itemStatus[item.status];
  const priorityLabel = t.priority[item.priority];

  return (
    <div className="animate-fade-slide-in relative flex gap-5">
      {/* Timeline spine */}
      <div className="relative flex flex-col items-center pt-1.5">
        <div className={`relative z-10 h-3 w-3 rounded-full ${visual.dotColor} ring-[3px] ring-[var(--background)]`}>
          {item.status === 'in_progress' && (
            <div className="absolute inset-0 rounded-full bg-cyan-400/30 animate-ping" />
          )}
        </div>
        {index < total - 1 && (
          <div className={`mt-1 w-px flex-1 ${item.status === 'in_progress' ? 'bg-cyan-500/25' : 'bg-primary/8'}`} />
        )}
      </div>

      {/* Card */}
      <div className="flex-1 pb-6">
        <div className="rounded-xl border border-primary/6 bg-gradient-to-br from-primary/[0.02] to-transparent p-4 transition-all duration-200 hover:border-primary/12 hover:bg-primary/[0.03]">
          <div className="flex items-start gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/8 ring-1 ring-primary/10 font-mono text-xs font-bold text-foreground shrink-0">
              {item.sort_order}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                {/* Title uses theme accent + soft glow for hierarchy (see CLAUDE.md UI Conventions). */}
                <h3 className="typo-heading text-primary text-[14px] [text-shadow:_0_0_10px_color-mix(in_oklab,var(--primary)_35%,transparent)]">
                  {item.title}
                </h3>
                <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-medium tracking-wider uppercase ${visual.badgeBg} ${visual.badgeText}`}>
                  {statusLabel}
                </span>
                <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-medium tracking-wider uppercase ${priorityClass}`}>
                  {priorityLabel}
                </span>
              </div>
              <p className="typo-body text-foreground mt-1 text-[12px] leading-relaxed">{item.description}</p>
            </div>
          </div>
        </div>
        {item.status === 'in_progress' && (
          <div className="pointer-events-none absolute inset-y-0 right-0 left-8 z-10 rounded-xl overflow-hidden">
            <svg className="absolute inset-0 h-full w-full" preserveAspectRatio="none">
              <rect
                x="0.5" y="0.5"
                width="calc(100% - 1px)" height="calc(100% - 25px)"
                rx="12" ry="12"
                fill="none"
                stroke="rgba(6,182,212,0.15)"
                strokeWidth="1"
                strokeDasharray="6 6"
                style={{ animation: 'dash-flow 2s linear infinite' }}
              />
            </svg>
          </div>
        )}
      </div>
    </div>
  );
}

interface HomeRoadmapViewProps {
  release: Release;
}

export default function HomeRoadmapView({ release }: HomeRoadmapViewProps) {
  const { t } = useReleasesTranslation();
  const releaseI18n = t.releases[release.version as keyof typeof t.releases];
  const i18nItems = releaseI18n?.items as Record<string, { title: string; description: string }> | undefined;

  const items = release.items
    .map((item, idx) => toDisplayItem(item, idx + 1, i18nItems))
    .sort((a, b) => a.sort_order - b.sort_order);
  const inProgressCount = items.filter((i) => i.status === 'in_progress').length;
  const nextCount = items.filter((i) => i.status === 'planned').length;

  return (
    <div className="relative">
      {/* Background mesh */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[20%] w-[400px] h-[400px] bg-cyan-500/4 blur-[120px] rounded-full" />
        <div className="absolute bottom-[0%] right-[10%] w-[300px] h-[300px] bg-purple-500/3 blur-[100px] rounded-full" />
      </div>

      <div className="w-full max-w-2xl mx-auto space-y-6 relative z-10">
        {items.length > 0 && (
          <>
            {/* Summary pills */}
            <div className="animate-fade-slide-in flex flex-wrap gap-3">
              <div className="flex items-center gap-2 rounded-full border border-cyan-500/15 bg-cyan-500/5 px-3 py-1.5">
                <div className="h-1.5 w-1.5 rounded-full bg-cyan-400 shadow-[0_0_4px_rgba(6,182,212,0.6)]" />
                <span className="text-[11px] font-mono font-medium text-cyan-400">
                  {format(t.summary.inProgress, { count: inProgressCount })}
                </span>
              </div>
              {nextCount > 0 && (
                <div className="flex items-center gap-2 rounded-full border border-purple-500/15 bg-purple-500/5 px-3 py-1.5">
                  <div className="h-1.5 w-1.5 rounded-full bg-purple-400" />
                  <span className="text-[11px] font-mono font-medium text-purple-400">
                    {format(t.summary.next, { count: nextCount })}
                  </span>
                </div>
              )}
            </div>

            {/* Timeline */}
            <div className="pt-2">
              {items.map((item, i) => (
                <RoadmapCard key={item.id} item={item} index={i} total={items.length} t={t} />
              ))}
            </div>
          </>
        )}
      </div>

      {/* CSS keyframe for dashed border animation */}
      <style>{`
        @keyframes dash-flow {
          to { stroke-dashoffset: -24; }
        }
      `}</style>
    </div>
  );
}
