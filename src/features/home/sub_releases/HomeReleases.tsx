/**
 * Home → "What's New" — a single lean view. Replaces the former nav-rail +
 * selection-persistence + separate roadmap / changelog components (5 files)
 * with one surface: the live roadmap (hero + NOW/NEXT/LATER lanes) on top,
 * then a compact list of the shipped bundled releases below.
 *
 * Live-roadmap fetch/cache/stale/fallback is unchanged (`useLiveRoadmap` +
 * `roadmapItems.buildDisplayItems`). Viewing acknowledges the running version
 * (clears the sidebar "What's New" dot).
 */
import { Rocket } from 'lucide-react';
import { useEffect } from 'react';
import { useWhatsNewIndicator } from '@/hooks/sidebar/useWhatsNewIndicator';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import {
  getNavReleases,
  RELEASE_STATUS_META,
  RELEASE_TYPE_META,
  type Release,
  type ReleaseItemStatus,
  type ReleaseItemPriority,
} from '@/data/releases';
import { useReleasesTranslation, type ReleasesTranslation } from './i18n/useReleasesTranslation';
import { useLiveRoadmap } from './useLiveRoadmap';
import { LiveRoadmapStatusPill } from './LiveRoadmapStatusPill';
import { buildDisplayItems, ROADMAP_PRIORITIES, type DisplayItem } from './roadmapItems';

const statusDot: Record<ReleaseItemStatus, string> = {
  in_progress: 'bg-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.6)]',
  planned: 'bg-foreground/30',
  completed: 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.6)]',
};

const laneAccent: Record<ReleaseItemPriority, { label: string; bg: string; border: string; chip: string }> = {
  now: { label: 'text-cyan-400', bg: 'bg-cyan-500/8', border: 'border-cyan-500/20', chip: 'text-cyan-400' },
  next: { label: 'text-purple-400', bg: 'bg-purple-500/8', border: 'border-purple-500/20', chip: 'text-purple-400' },
  later: { label: 'text-foreground', bg: 'bg-secondary/40', border: 'border-primary/12', chip: 'text-foreground' },
};

function RoadmapHero({ item, t }: { item: DisplayItem; t: ReleasesTranslation }) {
  return (
    <article className="animate-fade-slide-in">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <span className="relative flex items-center gap-2">
          <span className={`relative h-2 w-2 rounded-full ${statusDot[item.status]}`}>
            {item.status === 'in_progress' && (
              <span className="absolute inset-0 -m-0.5 rounded-full bg-cyan-400/30 animate-ping" />
            )}
          </span>
          <span className="font-mono text-xs uppercase tracking-[0.22em] text-cyan-400">{t.itemStatus[item.status]}</span>
        </span>
        <span className="font-mono text-xs text-foreground">· #{item.sort_order} · {t.priority[item.priority]}</span>
      </div>
      <div className="rounded-modal border border-cyan-500/15 bg-gradient-to-br from-cyan-500/[0.05] via-primary/[0.03] to-transparent p-7">
        <h2 className="typo-heading text-2xl font-semibold leading-tight text-primary [text-shadow:_0_0_18px_color-mix(in_oklab,var(--primary)_38%,transparent)]">
          {item.title}
        </h2>
        {item.description && (
          <p className="typo-body mt-4 max-w-prose text-base leading-relaxed text-foreground">{item.description}</p>
        )}
      </div>
    </article>
  );
}

function LaneColumn({ priority, items, t }: { priority: ReleaseItemPriority; items: DisplayItem[]; t: ReleasesTranslation }) {
  const accent = laneAccent[priority];
  return (
    <div className="flex flex-col gap-3">
      <header className="flex items-center justify-between border-b border-primary/8 pb-2">
        <span className={`typo-label font-semibold uppercase tracking-[0.18em] ${accent.label}`}>{t.priority[priority]}</span>
        <span className={`rounded-full border px-1.5 py-0.5 font-mono text-[11px] font-medium ${accent.bg} ${accent.border} ${accent.chip}`}>
          {items.length}
        </span>
      </header>
      {items.length === 0 ? (
        <div className="flex h-24 items-center justify-center rounded-modal border border-dashed border-primary/8 typo-caption text-foreground">—</div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <div key={item.id} className="animate-fade-slide-in relative overflow-hidden rounded-modal border border-primary/8 bg-gradient-to-br from-primary/[0.03] to-transparent p-4 pl-5">
              <div className={`absolute inset-y-3 left-1.5 w-[3px] rounded-full ${statusDot[item.status]}`} />
              <h3 className="typo-heading text-base font-semibold leading-tight text-primary">{item.title}</h3>
              <div className="mt-1.5 font-mono text-xs uppercase tracking-wider text-foreground">{t.itemStatus[item.status]}</div>
              {item.description && <p className="typo-body mt-2 text-sm leading-relaxed text-foreground">{item.description}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Compact card for one shipped release: header + summary + flat item list. */
function BundledReleaseCard({ release, t }: { release: Release; t: ReleasesTranslation }) {
  const meta = RELEASE_STATUS_META[release.status];
  const i18n = t.releases[release.version as keyof typeof t.releases];
  const items = i18n?.items as Record<string, { title: string; description: string }> | undefined;
  return (
    <section className="rounded-modal border border-primary/8 bg-gradient-to-br from-primary/[0.02] to-transparent p-5">
      <div className="flex flex-wrap items-baseline gap-3">
        <h3 className="typo-heading text-lg font-semibold text-primary [text-shadow:_0_0_12px_color-mix(in_oklab,var(--primary)_32%,transparent)]">
          {i18n?.label ?? release.version}
        </h3>
        <span className="font-mono text-xs text-foreground">{release.version}</span>
        <span className={['rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider', meta.badgeBg, meta.badgeText, meta.badgeBorder].join(' ')}>
          {t.status[release.status]}
        </span>
        {release.released_at && <span className="font-mono text-[11px] text-foreground">{release.released_at}</span>}
      </div>
      {i18n?.summary && <p className="typo-body mt-2 text-[13px] leading-relaxed text-foreground">{i18n.summary}</p>}
      <ul className="mt-3 space-y-1.5">
        {release.items.map((item) => {
          const typeMeta = RELEASE_TYPE_META[item.type];
          const content = items?.[item.id];
          return (
            <li key={item.id} className="flex items-start gap-2.5">
              <span className={['mt-0.5 shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider', typeMeta.badgeBg, typeMeta.badgeText, typeMeta.badgeBorder].join(' ')}>
                {t.type[item.type]}
              </span>
              <span className="typo-body text-[13px] text-foreground">{content?.title ?? `[${release.version}.${item.id}]`}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default function HomeReleases() {
  const { t, language } = useReleasesTranslation();
  const live = useLiveRoadmap();
  const { dismiss: dismissWhatsNew } = useWhatsNewIndicator();

  useEffect(() => {
    dismissWhatsNew();
  }, [dismissWhatsNew]);

  const nav = getNavReleases();
  const roadmap = nav.find((r) => r.status === 'roadmap');
  const shipped = nav.filter((r) => r.status !== 'roadmap');

  const roadmapItems = roadmap
    ? buildDisplayItems(
        roadmap,
        live.roadmap,
        language,
        t.releases[roadmap.version as keyof typeof t.releases]?.items as
          | Record<string, { title: string; description: string }>
          | undefined,
      )
    : [];
  const hero = roadmapItems.find((i) => i.status === 'in_progress') ?? roadmapItems[0];
  const remaining = hero ? roadmapItems.filter((i) => i !== hero) : [];

  return (
    <ContentBox>
      <ContentHeader icon={<Rocket className="w-5 h-5 text-cyan-400" />} iconColor="cyan" title={t.title} subtitle={t.subtitle.roadmap} />
      <ContentBody>
        <div className="relative z-10 mx-auto w-full max-w-6xl space-y-10">
          {hero && (
            <div className="mx-auto w-full max-w-3xl space-y-3">
              <div className="flex justify-end">
                <LiveRoadmapStatusPill
                  status={live.status}
                  fetchedAt={live.fetchedAt}
                  refreshing={live.refreshing}
                  onRefresh={live.refresh}
                  t={t}
                  language={language}
                />
              </div>
              <RoadmapHero item={hero} t={t} />
            </div>
          )}

          {remaining.length > 0 && (
            <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
              {ROADMAP_PRIORITIES.map((p) => (
                <LaneColumn key={p} priority={p} items={remaining.filter((i) => i.priority === p)} t={t} />
              ))}
            </div>
          )}

          {shipped.length > 0 && (
            <div className="mx-auto w-full max-w-3xl space-y-4">
              <span className="typo-section-title">{t.navRailLabel}</span>
              {shipped.map((release) => (
                <BundledReleaseCard key={release.version} release={release} t={t} />
              ))}
            </div>
          )}
        </div>
      </ContentBody>
    </ContentBox>
  );
}
