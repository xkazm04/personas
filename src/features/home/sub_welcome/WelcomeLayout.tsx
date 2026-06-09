import { lazy, Suspense } from 'react';
import { SuspenseFallback } from '@/features/shared/components/feedback/SuspenseFallback';
import { HeroMesh } from '@/features/shared/components/display/HeroMesh';
import { DeferUntilIdle } from '@/features/shared/components/layout/DeferUntilIdle';
import HeroHeader from './HeroHeader';
import NavigationGrid, { type NavCard } from './NavigationGrid';
import type { NavStatChip } from './lib/useNavCardStatus';
import ResumeBanner from './ResumeBanner';
import { useTranslation } from '@/i18n/useTranslation';

const LanguageCards = lazy(() => import('./LanguageSwitcher').then(m => ({ default: m.LanguageCardGrid })));

function SectionDivider({ label }: { label: string }) {
  return (
    <div className="animate-fade-slide-in motion-reduce:animate-none motion-reduce:opacity-100 motion-reduce:translate-y-0 flex items-center gap-3">
      <div className="h-px flex-1 bg-gradient-to-r from-transparent via-primary/10 to-transparent" />
      <span className="typo-section-title">{label}</span>
      <div className="h-px flex-1 bg-gradient-to-r from-transparent via-primary/10 to-transparent" />
    </div>
  );
}

interface WelcomeLayoutProps {
  greeting: string;
  displayName: string;
  quickNavLabel: string;
  navCards: NavCard[];
  navTranslations: Record<string, { label: string; description: string }>;
  navStatus: Record<string, NavStatChip[]>;
  onCardClick: (id: string) => void;
}

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
        <div className="w-full px-6 py-4 space-y-4">
          <ResumeBanner />
          <HeroHeader greeting={greeting} displayName={displayName} />

          {/* Below-fold content deferred to keep initial DOM small. WebView2
              hangs when too many nodes commit at once; `next-frame` runs as
              soon as the first paint is on screen. */}
          <DeferUntilIdle priority="next-frame">
            <SectionDivider label={quickNavLabel} />
            <NavigationGrid cards={navCards} translations={navTranslations} status={navStatus} onCardClick={onCardClick} />

            <SectionDivider label={wl.language} />
            <Suspense fallback={<SuspenseFallback />}>
              <LanguageCards />
            </Suspense>
          </DeferUntilIdle>
        </div>
      </div>
    </div>
  );
}
