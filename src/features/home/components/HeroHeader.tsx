import { useMemo } from 'react';
import { useIsDarkTheme } from '@/stores/themeStore';
import { useTier } from '@/hooks/utility/interaction/useTier';

const BG_OPTIONS = [
  '/illustrations/bg-v1-command-room.png',
  '/illustrations/bg-v2-orchestrator.png',
  '/illustrations/bg-v3-constellation.png',
];

interface HeroHeaderProps {
  greeting: string;
  displayName: string;
}

export default function HeroHeader({ greeting, displayName }: HeroHeaderProps) {
  const isDark = useIsDarkTheme();
  const { isStarter } = useTier();
  const bgSrc = useMemo(() => {
    if (isStarter) {
      return isDark ? '/illustrations/bg-simple-dark.png' : '/illustrations/bg-simple-light.png';
    }
    return BG_OPTIONS[Math.floor(Math.random() * BG_OPTIONS.length)]!;
  }, [isStarter, isDark]);

  return (
    <div className="relative w-full">
      {(isDark || isStarter) && (
        <div className="animate-fade-slide-in absolute inset-0 -top-4 -left-4 -right-4 overflow-hidden pointer-events-none z-0 rounded-2xl">
          <img src={bgSrc} alt="" loading="eager" decoding="async" className={`w-full h-full object-cover ${!isDark ? 'opacity-60' : ''}`} />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-background" />
        </div>
      )}
      <div className="relative z-10">
        <div className="animate-fade-slide-in flex items-center justify-center gap-6 py-6">
          <div className="relative group flex-shrink-0">
            <div className="relative w-20 h-20 flex items-center justify-center">
              <img
                src="/illustrations/logo-v1-geometric-nobg.png"
                alt="Personas logo"
                loading="eager"
                decoding="async"
                className="max-w-full max-h-full object-contain relative z-10 drop-shadow-[0_0_20px_rgba(139,92,246,0.4)]"
              />
            </div>
          </div>
          <h1 className="animate-fade-slide-in typo-hero font-display typo-hero-shine">
            {greeting}, {displayName}
          </h1>
        </div>
      </div>
    </div>
  );
}
