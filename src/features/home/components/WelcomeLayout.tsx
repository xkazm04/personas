import { lazy, Suspense } from 'react';
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

function HeroMesh() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      <div className="absolute top-[-20%] left-[10%] w-[500px] h-[500px] bg-indigo-500/5 blur-[150px] rounded-full" />
      <div className="absolute top-[10%] right-[-5%] w-[400px] h-[400px] bg-cyan-500/5 blur-[120px] rounded-full" />
      <div className="absolute bottom-[-10%] left-[30%] w-[350px] h-[350px] bg-purple-500/4 blur-[120px] rounded-full" />
      <div className="absolute inset-0 bg-[linear-gradient(rgba(59,130,246,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(59,130,246,0.02)_1px,transparent_1px)] bg-[size:48px_48px]" />
    </div>
  );
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
      <HeroMesh />
      <div className="flex-1 overflow-y-auto relative z-10">
        <div className="w-full px-6 py-4 space-y-4">
          <HeroHeader greeting={greeting} displayName={displayName} />

          <SetupCards />

          <div className="animate-fade-slide-in flex items-center gap-3">
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-primary/10 to-transparent" />
            <span className="typo-label text-muted-foreground/50">{quickNavLabel}</span>
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-primary/10 to-transparent" />
          </div>

          <NavigationGrid cards={navCards} translations={navTranslations} onCardClick={onCardClick} />

          <div className="animate-fade-slide-in flex items-center gap-3">
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-primary/10 to-transparent" />
            <span className="typo-label text-muted-foreground/50">Language</span>
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-primary/10 to-transparent" />
          </div>

          <Suspense fallback={null}>
            <LanguageCards />
          </Suspense>

          <div className="animate-fade-slide-in flex items-center justify-center pt-4 pb-8">
            <div className="flex items-center gap-2 typo-label text-muted-foreground/50">
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
