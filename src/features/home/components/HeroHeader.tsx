import { useMemo } from 'react';

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
  const bgSrc = useMemo(() => BG_OPTIONS[Math.floor(Math.random() * BG_OPTIONS.length)]!, []);

  return (
    <div className="relative w-full">
      {/* Random cinematic background at low opacity */}
      <div
        className="animate-fade-slide-in absolute inset-0 -top-4 -left-4 -right-4 overflow-hidden pointer-events-none z-0 rounded-2xl"
      >
        <img src={bgSrc} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-background" />
      </div>

      <div className="relative z-10">
        {/* Logo + greeting -- centered row */}
        <div
          className="animate-fade-slide-in flex items-center justify-center gap-6 py-6"
        >
          {/* Logo */}
          <div className="relative group flex-shrink-0">
            <div className="relative w-20 h-20 flex items-center justify-center">
              <div className="absolute inset-2 bg-primary/20 blur-3xl rounded-full opacity-60 group-hover:opacity-80 transition-opacity duration-700" />
              <img
                src="/illustrations/logo-v1-geometric-nobg.png"
                alt="Personas logo"
                loading="lazy"
                decoding="async"
                className="max-w-full max-h-full object-contain relative z-10 drop-shadow-[0_0_20px_rgba(139,92,246,0.4)]"
              />
            </div>
          </div>

          {/* Greeting with animated shine */}
          <h1
            className="animate-fade-slide-in typo-hero font-display typo-hero-shine"
          >
            {greeting}, {displayName}
          </h1>
        </div>
      </div>
    </div>
  );
}
