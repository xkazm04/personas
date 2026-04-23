/**
 * Roadmap view for the special `roadmap` release entry.
 *
 * Layout: a hero card on top (the active in-progress item, given full
 * editorial weight — large title, full description, live indicator). Below
 * it, the remaining items are grouped into three priority lanes —
 * NOW / NEXT / LATER — running across in a kanban-style triage board.
 * Build status appears as a colored stripe down each lane card's left
 * edge, so priority (lane position) and status (stripe colour) don't fight
 * each other for the reader's attention.
 *
 * Data sources:
 * - **Structural** (item ids, type, status, priority, sort_order) and
 *   **content** (titles, descriptions) come from `liveOverride` when the
 *   prop is provided; otherwise fall back to the bundled `release` +
 *   `useReleasesTranslation`. This is how the Live Roadmap feature lets
 *   the developer update the in-app roadmap without cutting a new release.
 *   See `docs/concepts/live-roadmap.md`.
 * - **Chrome** (status names, priority names, summary-pill copy) always
 *   comes from the shipped i18n bundle because those are tied to the UI
 *   shipped with the binary, not to roadmap content.
 *
 * i18n: see `.claude/CLAUDE.md` → "Internationalization".
 */
import type { Release, ReleaseItem, ReleaseItemPriority, ReleaseItemStatus } from '@/data/releases';
import type { LiveRoadmap, LiveRoadmapItem } from '@/api/liveRoadmap';
import { useReleasesTranslation } from './i18n/useReleasesTranslation';
import type { ReleasesTranslation } from './i18n/useReleasesTranslation';
import type { LiveRoadmapStatus } from './useLiveRoadmap';
import { LiveRoadmapStatusPill } from './LiveRoadmapStatusPill';

interface DisplayItem {
  id: string;
  title: string;
  description: string;
  status: ReleaseItemStatus;
  priority: ReleaseItemPriority;
  sort_order: number;
}

const statusDot: Record<ReleaseItemStatus, string> = {
  in_progress: 'bg-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.6)]',
  planned:     'bg-foreground/30',
  completed:   'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.6)]',
};

const statusStripe: Record<ReleaseItemStatus, string> = {
  in_progress: 'bg-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.55)]',
  planned:     'bg-foreground/30',
  completed:   'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.55)]',
};

const laneAccent: Record<
  ReleaseItemPriority,
  { label: string; bg: string; border: string; chip: string }
> = {
  now:   { label: 'text-cyan-400',   bg: 'bg-cyan-500/8',   border: 'border-cyan-500/20',   chip: 'text-cyan-400' },
  next:  { label: 'text-purple-400', bg: 'bg-purple-500/8', border: 'border-purple-500/20', chip: 'text-purple-400' },
  later: { label: 'text-foreground', bg: 'bg-secondary/40', border: 'border-primary/12',    chip: 'text-foreground' },
};

const PRIORITIES: ReleaseItemPriority[] = ['now', 'next', 'later'];
const KNOWN_STATUSES: ReadonlySet<ReleaseItemStatus> = new Set(['in_progress', 'planned', 'completed']);
const KNOWN_PRIORITIES: ReadonlySet<ReleaseItemPriority> = new Set(['now', 'next', 'later']);

function narrowStatus(raw: string | null | undefined): ReleaseItemStatus {
  return raw && KNOWN_STATUSES.has(raw as ReleaseItemStatus) ? (raw as ReleaseItemStatus) : 'planned';
}

function narrowPriority(raw: string | null | undefined): ReleaseItemPriority {
  return raw && KNOWN_PRIORITIES.has(raw as ReleaseItemPriority) ? (raw as ReleaseItemPriority) : 'later';
}

/** Build a DisplayItem from the bundled JSON + i18n entry. */
function fromBundled(
  item: ReleaseItem,
  fallbackOrder: number,
  i18nItems: Record<string, { title: string; description: string }> | undefined,
): DisplayItem {
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

/** Build a DisplayItem from a live-fetched item + locale block. */
function fromLive(
  item: LiveRoadmapItem,
  fallbackOrder: number,
  locale: LiveRoadmap['i18n'][string] | undefined,
): DisplayItem {
  const content = locale?.items[item.id];
  return {
    id: item.id,
    title: content?.title ?? `[roadmap.${item.id}]`,
    description: content?.description ?? '',
    status: narrowStatus(item.status),
    priority: narrowPriority(item.priority),
    sort_order: item.sortOrder ?? fallbackOrder,
  };
}

function buildDisplayItems(
  release: Release,
  liveOverride: LiveRoadmap | null | undefined,
  language: string,
  bundledItems: Record<string, { title: string; description: string }> | undefined,
): DisplayItem[] {
  if (liveOverride) {
    const locale = liveOverride.i18n[language] ?? liveOverride.i18n.en;
    return liveOverride.release.items
      .map((item, idx) => fromLive(item, idx + 1, locale))
      .sort((a, b) => a.sort_order - b.sort_order);
  }
  return release.items
    .map((item, idx) => fromBundled(item, idx + 1, bundledItems))
    .sort((a, b) => a.sort_order - b.sort_order);
}

function RoadmapHero({ item, t }: { item: DisplayItem; t: ReleasesTranslation }) {
  return (
    <article className="animate-fade-slide-in relative">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <span className="relative flex items-center gap-2">
          <span className={`relative h-2 w-2 rounded-full ${statusDot[item.status]}`}>
            {item.status === 'in_progress' && (
              <span className="absolute inset-0 -m-0.5 rounded-full bg-cyan-400/30 animate-ping" />
            )}
          </span>
          <span className="font-mono text-xs uppercase tracking-[0.22em] text-cyan-400">
            {t.itemStatus[item.status]}
          </span>
        </span>
        <span className="font-mono text-xs text-foreground/60">·</span>
        <span className="font-mono text-xs text-foreground/80">#{item.sort_order}</span>
        <span className="font-mono text-xs text-foreground/60">·</span>
        <span className="font-mono text-xs uppercase tracking-[0.22em] text-foreground/80">
          {t.priority[item.priority]}
        </span>
      </div>

      <div className="rounded-modal border border-cyan-500/15 bg-gradient-to-br from-cyan-500/[0.05] via-primary/[0.03] to-transparent p-7">
        <h2 className="typo-heading text-2xl font-semibold leading-tight text-primary [text-shadow:_0_0_18px_color-mix(in_oklab,var(--primary)_38%,transparent)]">
          {item.title}
        </h2>
        {item.description && (
          <p className="typo-body mt-4 max-w-prose text-base leading-relaxed text-foreground">
            {item.description}
          </p>
        )}
      </div>
    </article>
  );
}

function LaneCard({ item, t }: { item: DisplayItem; t: ReleasesTranslation }) {
  const stripe = statusStripe[item.status];
  return (
    <div className="animate-fade-slide-in group relative overflow-hidden rounded-modal border border-primary/8 bg-gradient-to-br from-primary/[0.03] to-transparent p-4 pl-5 transition-colors duration-200 hover:border-primary/16 hover:bg-primary/[0.04]">
      <div className={`absolute inset-y-3 left-1.5 w-[3px] rounded-full ${stripe}`} />
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-card bg-primary/10 font-mono typo-code text-sm font-bold text-foreground ring-1 ring-primary/12">
          {item.sort_order}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="typo-heading text-base font-semibold leading-tight text-primary [text-shadow:_0_0_10px_color-mix(in_oklab,var(--primary)_30%,transparent)]">
            {item.title}
          </h3>
          <div className="mt-1.5">
            <span className="font-mono text-xs uppercase tracking-wider text-foreground/80">
              {t.itemStatus[item.status]}
            </span>
          </div>
          {item.description && (
            <p className="typo-body mt-2 text-sm leading-relaxed text-foreground">
              {item.description}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function LaneColumn({
  priority,
  items,
  t,
}: {
  priority: ReleaseItemPriority;
  items: DisplayItem[];
  t: ReleasesTranslation;
}) {
  const accent = laneAccent[priority];
  const label = t.priority[priority];
  return (
    <div className="flex flex-col gap-3">
      <header className="flex items-center justify-between border-b border-primary/8 pb-2">
        <span className={`text-xs font-semibold uppercase tracking-[0.18em] ${accent.label}`}>
          {label}
        </span>
        <span
          className={`rounded-full border px-1.5 py-0.5 font-mono text-[11px] font-medium ${accent.bg} ${accent.border} ${accent.chip}`}
        >
          {items.length}
        </span>
      </header>
      {items.length === 0 ? (
        <div className="flex h-24 items-center justify-center rounded-modal border border-dashed border-primary/8 text-xs text-foreground/60">
          —
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <LaneCard key={item.id} item={item} t={t} />
          ))}
        </div>
      )}
    </div>
  );
}

interface HomeRoadmapViewProps {
  release: Release;
  /** Live-fetched roadmap payload. When present, overrides the bundled data. */
  liveOverride?: LiveRoadmap | null;
  liveStatus?: LiveRoadmapStatus;
  liveFetchedAt?: string | null;
  liveRefreshing?: boolean;
  onRefresh?: () => void;
}

export default function HomeRoadmapView({
  release,
  liveOverride,
  liveStatus,
  liveFetchedAt,
  liveRefreshing,
  onRefresh,
}: HomeRoadmapViewProps) {
  const { t, language } = useReleasesTranslation();
  const releaseI18n = t.releases[release.version as keyof typeof t.releases];
  const bundledItems = releaseI18n?.items as
    | Record<string, { title: string; description: string }>
    | undefined;

  const items = buildDisplayItems(release, liveOverride, language, bundledItems);

  // Hero: first in-progress item, or fall back to the first overall.
  // The hero is excluded from the lanes below so it's not duplicated.
  const hero = items.find((i) => i.status === 'in_progress') ?? items[0];
  if (!hero) return null;
  const remaining = items.filter((i) => i.id !== hero.id);

  return (
    <div className="relative">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute top-[-5%] left-[15%] h-[500px] w-[500px] rounded-full bg-cyan-500/4 blur-[140px]" />
        <div className="absolute right-[5%] bottom-[5%] h-[320px] w-[320px] rounded-full bg-purple-500/4 blur-[120px]" />
      </div>

      <div className="relative z-10 mx-auto w-full max-w-6xl space-y-10">
        <div className="mx-auto w-full max-w-3xl">
          {liveStatus && (
            <div className="mb-3 flex justify-end">
              <LiveRoadmapStatusPill
                status={liveStatus}
                fetchedAt={liveFetchedAt ?? null}
                refreshing={liveRefreshing ?? false}
                onRefresh={onRefresh}
                t={t}
                language={language}
              />
            </div>
          )}
          <RoadmapHero item={hero} t={t} />
        </div>

        {remaining.length > 0 && (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
            {PRIORITIES.map((p) => (
              <LaneColumn
                key={p}
                priority={p}
                items={remaining.filter((i) => i.priority === p)}
                t={t}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
