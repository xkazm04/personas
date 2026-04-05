import { lazy, Suspense } from 'react';
import { SuspenseFallback } from '@/features/shared/components/feedback/SuspenseFallback';
import { HeroMesh } from '@/features/shared/components/display/HeroMesh';
import HeroHeader from './HeroHeader';
import SetupCards from './SetupCards';
import NavigationGrid, { type NavCard } from './NavigationGrid';
import TourLauncher from '@/features/onboarding/components/TourLauncher';

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
  platformLabel: string;
  navCards: NavCard[];
  navTranslations: Record<string, { label: string; description: string }>;
  onCardClick: (id: string) => void;
}

export default function WelcomeLayout({
  greeting,
  displayName,
  quickNavLabel,
  platformLabel,
  navCards,
  navTranslations,
  onCardClick
}: WelcomeLayoutProps) {
  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden relative">
      <HeroMesh preset="welcome" />
      <div className="flex-1 overflow-y-auto relative z-10">
        <div className="w-full px-6 py-4 space-y-4">
          <HeroHeader greeting={greeting} displayName={displayName} />

          <div className="animate-fade-slide-in motion-reduce:animate-none motion-reduce:opacity-100 motion-reduce:translate-y-0 flex items-center gap-3">
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-primary/10 to-transparent" />
            <span className="typo-section-title">Get Started</span>
            <TourLauncher />
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-primary/10 to-transparent" />
          </div>

          <div style={{ contentVisibility: 'auto', containIntrinsicSize: '0 300px' } as React.CSSProperties}>
            <SetupCards />
          </div>

          <SectionDivider label={quickNavLabel} />

          <div style={{ contentVisibility: 'auto', containIntrinsicSize: '0 400px' } as React.CSSProperties}>
            <NavigationGrid cards={navCards} translations={navTranslations} onCardClick={onCardClick} />
          </div>

          <SectionDivider label="Language" />

          <div style={{ contentVisibility: 'auto', containIntrinsicSize: '0 200px' } as React.CSSProperties}>
            <Suspense fallback={<SuspenseFallback />}>
              <LanguageCards />
            </Suspense>
          </div>

          <div className="animate-fade-slide-in motion-reduce:animate-none motion-reduce:opacity-100 motion-reduce:translate-y-0 flex items-center justify-center pt-4 pb-8">
            <div className="flex items-center gap-2 text-sm text-muted-foreground/60">
              <div className="w-8 h-px bg-gradient-to-r from-transparent to-muted-foreground/20" />
              {platformLabel}
              <div className="w-8 h-px bg-gradient-to-l from-transparent to-muted-foreground/20" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
