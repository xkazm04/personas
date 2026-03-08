import { motion, AnimatePresence } from 'framer-motion';
import { useState } from 'react';
import LanguageSwitcher from './LanguageSwitcher';
import TourLauncher from '@/features/onboarding/components/TourLauncher';
import IconShowcase from './IconShowcase';

import decorativeCircuit from '@/assets/illustrations/decorative-circuit.svg';

// ── Types ───────────────────────────────────────────────────────────────

type VariantType = 'logo' | 'background' | 'empty-state' | 'decorative-svg' | 'icons';

interface HeroVariant {
  id: VariantType;
  name: string;
  strategy: string;
}

const VARIANTS: HeroVariant[] = [
  { id: 'logo', name: 'Identity Logo', strategy: 'Abstract Geometric Silhouettes — AI Agent Orchestration' },
  { id: 'background', name: 'Full Background', strategy: 'Cinematic Command Room — 3 Style Variants' },
  { id: 'empty-state', name: 'Empty State', strategy: 'Transparent BG via Leonardo remove-bg Pipeline' },
  { id: 'decorative-svg', name: 'SVG Decoration', strategy: 'Dynamic Theme Colors via currentColor' },
  { id: 'icons', name: 'Icon Set', strategy: 'Custom SVG Menu Icons — Leonardo + Gemini Pipeline' },
];

// ── Background variants ─────────────────────────────────────────────────

interface BgOption {
  id: string;
  label: string;
  src: string;
  style: string;
}

const BG_OPTIONS: BgOption[] = [
  { id: 'command-room', label: 'Command Room', src: '/illustrations/bg-v1-command-room.png', style: 'cinematic · contrast 2.5' },
  { id: 'orchestrator', label: 'Orchestrator', src: '/illustrations/bg-v2-orchestrator.png', style: 'dynamic · contrast 3' },
  { id: 'constellation', label: 'Constellation', src: '/illustrations/bg-v3-constellation.png', style: 'bokeh · contrast 1.8' },
];

// ── Component ───────────────────────────────────────────────────────────

interface HeroHeaderProps {
  greeting: string;
  displayName: string;
  summary: string;
}

export default function HeroHeader({ greeting, displayName, summary }: HeroHeaderProps) {
  const [activeVariant, setActiveVariant] = useState<HeroVariant>(VARIANTS[0]!);
  const [selectedBg, setSelectedBg] = useState<BgOption>(BG_OPTIONS[0]!);

  return (
    <div className="relative space-y-8">
      {/* Background layers */}
      <AnimatePresence mode="wait">
        {activeVariant.id === 'background' && (
          <motion.div
            key={`bg-${selectedBg.id}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.12 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8 }}
            className="absolute inset-0 -top-4 -left-4 -right-4 overflow-hidden pointer-events-none z-0 rounded-2xl"
          >
            <img src={selectedBg.src} alt="" className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-background" />
          </motion.div>
        )}
        {activeVariant.id !== 'background' && (
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-[1200px] h-[400px] pointer-events-none opacity-70 z-0">
            <img src={decorativeCircuit} alt="" className="w-full h-full object-cover text-primary" />
          </div>
        )}
      </AnimatePresence>

      <div className="relative z-10 space-y-8">
        {/* Top bar: variant tabs + language */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex bg-secondary/30 p-1 rounded-xl border border-border/50 backdrop-blur-sm shadow-sm overflow-x-auto">
            {VARIANTS.map((v) => (
              <button
                key={v.id}
                onClick={() => setActiveVariant(v)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
                  activeVariant.id === v.id
                    ? 'bg-primary text-primary-foreground shadow-md'
                    : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
                }`}
              >
                {v.name}
              </button>
            ))}
          </div>
          <LanguageSwitcher />
        </div>

        {/* Strategy label */}
        <motion.div
          key={activeVariant.id}
          initial={{ opacity: 0, y: -5 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-center gap-3"
        >
          <span className="typo-label text-[10px] text-primary/70">
            {activeVariant.strategy}
          </span>
        </motion.div>

        {/* Main visual area */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="text-center pt-4 pb-2"
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={activeVariant.id}
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
              className="flex flex-col items-center mb-10"
            >
              {/* Identity logo — single geometric mark */}
              {activeVariant.id === 'logo' && (
                <div className="relative group inline-flex items-center justify-center">
                  <div className="relative w-48 h-48 flex items-center justify-center">
                    <div className="absolute inset-4 bg-primary/20 blur-3xl rounded-full opacity-60 group-hover:opacity-80 transition-opacity duration-700" />
                    <img
                      src="/illustrations/logo-v1-geometric-nobg.png"
                      alt="Personas logo"
                      className="max-w-full max-h-full object-contain relative z-10 drop-shadow-[0_0_20px_rgba(139,92,246,0.4)]"
                    />
                    <div className="absolute inset-[-20px] rounded-full border border-primary/5 animate-spin-slow pointer-events-none" />
                  </div>
                </div>
              )}

              {/* Background variant — 3 options with switcher */}
              {activeVariant.id === 'background' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-center gap-3">
                    {BG_OPTIONS.map((bg) => (
                      <button
                        key={bg.id}
                        onClick={() => setSelectedBg(bg)}
                        className={`group relative overflow-hidden rounded-xl border-2 transition-all ${
                          selectedBg.id === bg.id
                            ? 'border-primary/40 shadow-lg shadow-primary/20 scale-105'
                            : 'border-border/30 opacity-50 hover:opacity-80 hover:border-primary/20'
                        }`}
                      >
                        <img
                          src={bg.src}
                          alt={bg.label}
                          className="w-40 h-14 object-cover"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                        <span className="absolute bottom-1 left-2 text-[10px] font-medium text-white/90">
                          {bg.label}
                        </span>
                      </button>
                    ))}
                  </div>
                  <div className="relative w-40 h-40 flex items-center justify-center mx-auto">
                    <div className="absolute inset-4 bg-primary/10 blur-3xl rounded-full opacity-40" />
                    <div className="relative z-10 w-20 h-20 rounded-2xl border border-primary/20 bg-primary/5 backdrop-blur-sm flex items-center justify-center">
                      <span className="text-3xl font-black bg-gradient-to-br from-primary to-accent bg-clip-text text-transparent">P</span>
                    </div>
                  </div>
                  <p className="text-[11px] text-muted-foreground/50 font-mono">
                    Leonardo Lucid Origin · {selectedBg.style}
                  </p>
                </div>
              )}

              {/* Empty state — centered image */}
              {activeVariant.id === 'empty-state' && (
                <div className="relative w-40 h-40 flex items-center justify-center group">
                  <div className="absolute inset-4 bg-primary/20 blur-3xl rounded-full opacity-60 group-hover:opacity-80 transition-opacity duration-700" />
                  <img
                    src="/illustrations/leo-empty-state.png"
                    alt="Empty state robot"
                    className="max-w-full max-h-full object-contain relative z-10 drop-shadow-[0_0_15px_rgba(34,211,238,0.3)]"
                  />
                  <div className="absolute inset-[-20px] rounded-full border border-primary/5 animate-spin-slow pointer-events-none" />
                </div>
              )}

              {/* SVG decoration — themed */}
              {activeVariant.id === 'decorative-svg' && (
                <div className="relative w-48 h-48 flex items-center justify-center text-primary">
                  <div className="absolute inset-8 bg-primary/15 blur-3xl rounded-full opacity-50" />
                  <img
                    src={decorativeCircuit}
                    alt="Decorative circuit pattern"
                    className="w-full h-full object-contain relative z-10 opacity-70"
                    style={{ filter: 'drop-shadow(0 0 8px currentColor)' }}
                  />
                </div>
              )}

              {/* Icon set showcase */}
              {activeVariant.id === 'icons' && (
                <IconShowcase />
              )}
            </motion.div>
          </AnimatePresence>

          {activeVariant.id !== 'icons' && (
            <>
              <motion.h1
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2, duration: 0.4 }}
                className="typo-hero font-display bg-gradient-to-r from-foreground via-foreground/90 to-foreground/70 bg-clip-text text-transparent mb-3"
              >
                {greeting}, {displayName}
              </motion.h1>

              <motion.p
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3, duration: 0.4 }}
                className="typo-body-lg text-muted-foreground/80 max-w-lg mx-auto"
              >
                {summary}
              </motion.p>
            </>
          )}
        </motion.div>

        {/* Use case info card */}
        <AnimatePresence mode="wait">
          <motion.div
            key={activeVariant.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3 }}
            className="max-w-xl mx-auto"
          >
            <UseCaseCard variant={activeVariant} />
          </motion.div>
        </AnimatePresence>

        <div className="pt-2">
          <TourLauncher />
        </div>
      </div>
    </div>
  );
}

// ── Use case info cards ─────────────────────────────────────────────────

function UseCaseCard({ variant }: { variant: HeroVariant }) {
  const cards: Record<VariantType, { title: string; how: string; why: string } | null> = {
    'logo': {
      title: 'Identity Logo — Geometric Silhouettes',
      how: 'Generated with Leonardo Lucid Origin (dynamic style, contrast 3) with ML background removal. Abstract overlapping translucent silhouettes morphing into circuit/node patterns.',
      why: 'Multiple silhouettes represent many AI identities orchestrated as one — the core concept of Personas. Also used as the desktop app icon.',
    },
    'background': {
      title: 'Full Background — 3 Cinematic Variants',
      how: 'Leonardo Lucid Origin, 1536x512 wide format. Each variant uses a different style (cinematic, dynamic, bokeh) depicting an AI command room with holographic agent panels.',
      why: 'Rendered at 12% opacity for ambient depth. The command room metaphor — one operator orchestrating many AI agents — directly represents the Personas workflow.',
    },
    'empty-state': {
      title: 'Empty State (Transparent Background)',
      how: 'Generated with Leonardo Lucid Origin on solid dark bg, then processed through Leonardo\'s remove-bg ML pipeline for clean alpha extraction.',
      why: 'Empty states need transparency to sit on any surface. Leonardo\'s ML bg-removal produces clean edges without pixel artifacts.',
    },
    'decorative-svg': {
      title: 'SVG Decoration (Theme-Adaptive)',
      how: 'Mandala-like circuit pattern with 8-fold symmetry, animated nodes, and orbiting groups. All fills/strokes use currentColor. Rendered at 70% opacity.',
      why: 'The only approach that gives true dynamic theme colors. Changes from cyan to amber to red automatically. No image generation per theme needed.',
    },
    'icons': {
      title: 'Custom Icon Set — 9 Menu Icons',
      how: 'Each icon generated with Leonardo Lucid Origin, analyzed with Gemini vision, then hand-translated to SVG using currentColor for theme adaptation.',
      why: 'Custom icons give the app a unique identity vs generic icon libraries. SVG with currentColor means they automatically match any theme.',
    },
  };

  const card = cards[variant.id];
  if (!card) return null;

  return (
    <div className="rounded-xl border border-primary/10 bg-secondary/20 backdrop-blur-sm p-4 space-y-2">
      <h4 className="text-xs font-semibold text-foreground/80 uppercase tracking-wider">{card.title}</h4>
      <div className="space-y-1.5">
        <p className="text-sm text-muted-foreground/70">
          <span className="text-primary/70 font-medium">How: </span>{card.how}
        </p>
        <p className="text-sm text-muted-foreground/70">
          <span className="text-primary/70 font-medium">Why: </span>{card.why}
        </p>
      </div>
    </div>
  );
}
