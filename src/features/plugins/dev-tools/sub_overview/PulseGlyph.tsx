/**
 * PulseGlyph — a traced, self-drawing "mission-control pulse monitor" glyph.
 *
 * Motionized via `.claude/skills/motionize`: a flat vector was generated,
 * validated, and traced into `pulseGlyphData.ts` (one path per colour region +
 * a radial `delay`). Here we paint those paths as Motion elements and reveal
 * them centre-out — opacity always (plays under reduced motion), a scale-pop
 * from each path's own centre only when motion is allowed. Accent paths get an
 * emissive SVG glow, and a faint radial "fog" breathes behind the hero.
 *
 * We own the colouring, so the 17 messy trace hues are normalised into three
 * role tokens (violet frame / teal signal / amber accent) and recoloured per
 * theme — one geometry, a dark and a light palette. Interior negative space is
 * already `var(--background)`, so it flips with the theme for free.
 */
import { useId } from 'react';
import { motion } from 'framer-motion';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { useIsDarkTheme } from '@/stores/themeStore';
import { PULSE_GLYPH, PULSE_GLYPH_VIEWBOX } from './pulseGlyphData';

type Role = 'bg' | 'violet' | 'teal' | 'amber';

/** Classify a raw trace hue into a role (see module header). */
function classify(fill: string): Role {
  if (fill === 'var(--background)') return 'bg';
  const m = /^#([0-9a-fA-F]{6})$/.exec(fill);
  if (!m) return 'violet';
  const n = parseInt(m[1] ?? '0', 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  if (r < 40 && g < 40 && b < 40) return 'bg'; // near-black trace residue → surface
  if (r > 180 && b < 90) return 'amber';
  if (b > r && b > g) return 'violet';
  if (g > r && (g > b || b > r)) return 'teal';
  return 'violet';
}

// Precompute role + normalised centre-out order once (module scope, cheap).
const MAX_DELAY = Math.max(...PULSE_GLYPH.map((p) => p.delay)) || 1;
const ELEMENTS = PULSE_GLYPH.map((p) => ({
  d: p.d,
  role: classify(p.fill),
  t: p.delay / MAX_DELAY, // 0 (centre) → 1 (outer)
}));

const PALETTE: Record<'dark' | 'light', Record<Role, string>> = {
  dark: { bg: 'var(--background)', violet: '#8B5CF6', teal: '#2DD4BF', amber: '#F59E0B' },
  light: { bg: 'var(--background)', violet: '#7C3AED', teal: '#0D9488', amber: '#D97706' },
};

export function PulseGlyph({ size = 96, className }: { size?: number; className?: string }) {
  const { shouldAnimate } = useMotion();
  const isDark = useIsDarkTheme();
  const pal = PALETTE[isDark ? 'dark' : 'light'];
  const uid = useId().replace(/:/g, '');
  const glowId = `pulseglow-${uid}`;
  const fogId = `pulsefog-${uid}`;
  const SPREAD = 0.7; // seconds from centre to outermost path

  return (
    <svg
      viewBox={PULSE_GLYPH_VIEWBOX}
      width={size}
      height={size}
      className={className}
      role="img"
      aria-hidden="true"
    >
      <defs>
        <radialGradient id={fogId} cx="50%" cy="48%" r="52%">
          <stop offset="0%" stopColor={pal.teal} stopOpacity={isDark ? 0.18 : 0.1} />
          <stop offset="70%" stopColor={pal.violet} stopOpacity={isDark ? 0.08 : 0.05} />
          <stop offset="100%" stopColor={pal.teal} stopOpacity="0" />
        </radialGradient>
        <filter id={glowId} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation={isDark ? 5 : 2.5} result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Volumetric fog — breathes slowly to read as "alive". */}
      <motion.rect
        x="0"
        y="0"
        width="1024"
        height="1024"
        fill={`url(#${fogId})`}
        initial={{ opacity: 0 }}
        animate={{ opacity: shouldAnimate ? [0.5, 0.9, 0.5] : 0.7 }}
        transition={
          shouldAnimate
            ? { duration: 3.4, repeat: Infinity, ease: 'easeInOut' }
            : { duration: 0.6 }
        }
      />

      {ELEMENTS.map((el, i) => {
        // Negative space: paint immediately (invisible against the surface, but
        // it carves the holes/lines out of the accent fills drawn around it).
        if (el.role === 'bg') {
          return <path key={i} d={el.d} fill={pal.bg} />;
        }
        const accent = el.role === 'teal' || el.role === 'amber';
        return (
          <motion.path
            key={i}
            d={el.d}
            fill={pal[el.role]}
            filter={accent ? `url(#${glowId})` : undefined}
            style={{ transformOrigin: 'center', transformBox: 'fill-box' }}
            initial={shouldAnimate ? { opacity: 0, scale: 0.55 } : { opacity: 0 }}
            animate={shouldAnimate ? { opacity: 1, scale: 1 } : { opacity: 1 }}
            transition={{ delay: el.t * SPREAD, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          />
        );
      })}
    </svg>
  );
}
