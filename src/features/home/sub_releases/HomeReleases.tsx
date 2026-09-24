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
import EmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { useRevealTracker } from '@/hooks/utility/interaction/useProgressiveReveal';
import { getNavReleases } from '@/data/releases';
import { useReleasesTranslation } from './i18n/useReleasesTranslation';
import { useLiveRoadmap } from './useLiveRoadmap';
import { LiveRoadmapStatusPill } from './LiveRoadmapStatusPill';
import { buildDisplayItems, ROADMAP_PRIORITIES } from './roadmapItems';
import { RoadmapHero } from './RoadmapHero';
import { RoadmapLane } from './RoadmapLane';
import { BundledReleaseCard } from './BundledReleaseCard';

export default function HomeReleases() {
  const { t, language } = useReleasesTranslation();
  const live = useLiveRoadmap();
  const { dismiss: dismissWhatsNew } = useWhatsNewIndicator();
  // One-shot, id-guarded cascade (law 4): no resetKey — this surface has no
  // filter/sort to replay against, so ids stay marked "entered" for the life
  // of the mount and only a genuinely new item id fades in on its own.
  const enter = useRevealTracker();

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
        t.releases[roadmap.version]?.items,
      )
    : [];
  const hero = roadmapItems.find((i) => i.status === 'in_progress') ?? roadmapItems[0];
  const remaining = hero ? roadmapItems.filter((i) => i !== hero) : [];

  return (
    <ContentBox>
      <ContentHeader icon={<Rocket className="w-5 h-5 text-primary" />} iconColor="primary" title={t.title} subtitle={t.subtitle.roadmap} />
      <ContentBody>
        <div className="relative z-10 mx-auto w-full max-w-6xl space-y-10">
          {hero && (
            <div className="w-full space-y-3">
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
              <RoadmapHero item={hero} enter={enter} t={t} />
            </div>
          )}

          {/* Nothing resolved for the roadmap at all — no live payload, and no
              bundled item with content. Previously this rendered as a void
              between the header and the shipped releases (or, before
              `keepDisplayable`, as a wall of `[roadmap.<id>]` markers). The
              `empty` string has existed and been translated into all 14
              locales the whole time; it just had no surface. */}
          {roadmapItems.length === 0 && (
            <EmptyState
              icon={Rocket}
              title={t.empty}
              iconColor="text-primary"
              iconContainerClassName="bg-primary/10 border-primary/20"
            />
          )}

          {remaining.length > 0 && (
            <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
              {ROADMAP_PRIORITIES.map((p) => (
                <RoadmapLane key={p} priority={p} items={remaining.filter((i) => i.priority === p)} enter={enter} t={t} />
              ))}
            </div>
          )}

          {shipped.length > 0 && (
            <div className="w-full space-y-4">
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
