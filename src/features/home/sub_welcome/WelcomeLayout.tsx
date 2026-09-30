import { lazy, Suspense } from 'react';
import { HeroMesh } from '@/features/shared/components/display/HeroMesh';
import { DeferUntilIdle } from '@/features/shared/components/layout/DeferUntilIdle';
import { GhostRows, KitHost, Section, Surface } from '@/features/shared/components/kit';
import HeroHeader from './HeroHeader';
import GetStartedSection from './GetStartedSection';
import NavigationGrid, { type NavCard } from './NavigationGrid';
import type { NavStatChip } from './lib/useNavCardStatus';
import ResumeSection from './ResumeSection';
import SinceYouLeftBriefing from './SinceYouLeftBriefing';
import { useTranslation } from '@/i18n/useTranslation';

const LanguageCards = lazy(() => import('./LanguageSwitcher').then(m => ({ default: m.LanguageCardGrid })));

interface WelcomeLayoutProps {
  greeting: string;
  displayName: string;
  quickNavLabel: string;
  navCards: NavCard[];
  navTranslations: Record<string, { label: string; description: string }>;
  navStatus: Record<string, NavStatChip[]>;
  onCardClick: (id: string) => void;
}

/**
 * The Welcome surface, composed from the kit: the hero greeting opens the page, then one calm
 * spine carries what happened since the last visit, the continue pointer, the first-run entry,
 * the modules and the language picker. A showcase surface: the default type tier, not compact.
 */
export default function WelcomeLayout({
  greeting,
  displayName,
  quickNavLabel,
  navCards,
  navTranslations,
  navStatus,
  onCardClick
}: WelcomeLayoutProps) {
  const { t } = useTranslation();
  const wl = t.home.welcome_layout;

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden relative">
      <HeroMesh preset="welcome" />
      <div className="flex-1 overflow-y-auto relative z-10">
        <KitHost testId="home-welcome">
          <div className="w-full px-6 pt-4 pb-8">
            <HeroHeader greeting={greeting} displayName={displayName} />
            <Surface>
              <SinceYouLeftBriefing />
              <ResumeSection />
              <GetStartedSection />

              {/* Below-fold content deferred to keep initial DOM small. WebView2
                  hangs when too many nodes commit at once; `next-frame` runs as
                  soon as the first paint is on screen. */}
              <DeferUntilIdle priority="next-frame">
                <Section title={quickNavLabel}>
                  <NavigationGrid
                    cards={navCards}
                    translations={navTranslations}
                    status={navStatus}
                    onCardClick={onCardClick}
                    label={quickNavLabel}
                  />
                </Section>
                <Section title={wl.language}>
                  <Suspense fallback={<GhostRows count={2} />}>
                    <div className="k-in">
                      <LanguageCards />
                    </div>
                  </Suspense>
                </Section>
              </DeferUntilIdle>
            </Surface>
          </div>
        </KitHost>
      </div>
    </div>
  );
}
