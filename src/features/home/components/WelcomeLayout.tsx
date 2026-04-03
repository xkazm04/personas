import { lazy, Suspense } from 'react';
import { SuspenseFallback } from '@/features/shared/components/feedback/SuspenseFallback';
import { HeroMesh } from '@/features/shared/components/display/HeroMesh';
import HeroHeader from './HeroHeader';
import SetupCards from './SetupCards';
import NavigationGrid, { type NavCard } from './NavigationGrid';

const LanguageCards = lazy(() => import('./LanguageSwitcher').then(m => ({ default: m.LanguageCardGrid })));

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

          <SetupCards />

          <div className="animate-fade-slide-in motion-reduce:animate-none motion-reduce:opacity-100 motion-reduce:translate-y-0 flex items-center gap-3">
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-primary/10 to-transparent" />
            <span className="text-lg font-medium text-foreground/80">{quickNavLabel}</span>
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-primary/10 to-transparent" />
          </div>

          <NavigationGrid cards={navCards} translations={navTranslations} onCardClick={onCardClick} />

          <div className="animate-fade-slide-in motion-reduce:animate-none motion-reduce:opacity-100 motion-reduce:translate-y-0 flex items-center gap-3">
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-primary/10 to-transparent" />
            <span className="text-lg font-medium text-foreground/80">Language</span>
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-primary/10 to-transparent" />
          </div>

          <Suspense fallback={<SuspenseFallback />}>
            <LanguageCards />
          </Suspense>

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
