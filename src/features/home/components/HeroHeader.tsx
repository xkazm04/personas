import { motion } from 'framer-motion';
import { useMemo } from 'react';
import LanguageSwitcher from './LanguageSwitcher';
import TourLauncher from '@/features/onboarding/components/TourLauncher';

// ── Background variants (randomised per mount) ──────────────────────────

const BG_OPTIONS = [
  '/illustrations/bg-v1-command-room.png',
  '/illustrations/bg-v2-orchestrator.png',
  '/illustrations/bg-v3-constellation.png',
];

// ── Component ───────────────────────────────────────────────────────────

interface HeroHeaderProps {
  greeting: string;
  displayName: string;
}

export default function HeroHeader({ greeting, displayName }: HeroHeaderProps) {
  const bgSrc = useMemo(() => BG_OPTIONS[Math.floor(Math.random() * BG_OPTIONS.length)]!, []);

  return (
    <div className="relative">
      {/* Random cinematic background at low opacity */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.12 }}
        transition={{ duration: 1.2 }}
        className="absolute inset-0 -top-4 -left-4 -right-4 overflow-hidden pointer-events-none z-0 rounded-2xl"
      >
        <img src={bgSrc} alt="" className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-background" />
      </motion.div>

      <div className="relative z-10">
        {/* Top bar */}
        <div className="flex items-center justify-end">
          <LanguageSwitcher />
        </div>

        {/* Logo + greeting + tour — single compact row */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="flex items-center justify-center gap-6 py-4"
        >
          {/* Logo */}
          <div className="relative group flex-shrink-0">
            <div className="relative w-20 h-20 flex items-center justify-center">
              <div className="absolute inset-2 bg-primary/20 blur-3xl rounded-full opacity-60 group-hover:opacity-80 transition-opacity duration-700" />
              <img
                src="/illustrations/logo-v1-geometric-nobg.png"
                alt="Personas logo"
                className="max-w-full max-h-full object-contain relative z-10 drop-shadow-[0_0_20px_rgba(139,92,246,0.4)]"
              />
            </div>
          </div>

          {/* Greeting */}
          <motion.h1
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.4 }}
            className="typo-hero font-display bg-gradient-to-r from-foreground via-foreground/90 to-foreground/70 bg-clip-text text-transparent"
          >
            {greeting}, {displayName}
          </motion.h1>

          {/* Tour button */}
          <TourLauncher />
        </motion.div>
      </div>
    </div>
  );
}
