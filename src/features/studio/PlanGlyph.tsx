/**
 * PlanGlyph — a traced, self-drawing "build plan" glyph (a checklist timeline:
 * two completed step nodes, one still open, each with its plan item bar).
 *
 * Motionized via `.claude/skills/motionize`: flat art was generated, validated,
 * and traced into `planGlyphData.ts` (one path per colour region + a radial
 * `delay`). Here those paths are painted as Motion elements and revealed
 * centre-out — opacity always (so it still cross-fades under reduced motion), a
 * scale-pop from each path's own centre only when motion is allowed. The accent
 * nodes carry an emissive SVG glow and a faint radial fog breathes behind them.
 *
 * We own the colouring, so the trace's raw hues are normalised into four role
 * tokens (violet / teal / amber accents + navy ink line-work) and recoloured per
 * theme — one geometry, a dark AND a light palette. The trace's negative space is
 * `var(--background)`, so the ring's hole flips with the theme for free.
 */
import { useId } from 'react';
import { motion } from 'framer-motion';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { useIsDarkTheme } from '@/stores/themeStore';
import { PLAN_GLYPH, PLAN_GLYPH_VIEWBOX } from './planGlyphData';

type Role = 'bg' | 'ink' | 'violet' | 'teal' | 'amber';

/** Classify a raw trace hue into a role (see module header). */
function classify(fill: string): Role {
  if (fill === 'var(--background)') return 'bg';
  const m = /^#([0-9a-fA-F]{6})$/.exec(fill);
  if (!m) return 'ink';
  const n = parseInt(m[1] ?? '0', 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  if (r > 180 && b < 170) return 'amber';
  if (b > 200 && r > 100) return 'violet';
  if (g > 150 && b > 150 && r < 100) return 'teal';
  return 'ink'; // deep navy line-work: the connectors + the check marks
}

// The tracer keeps the source's full-canvas backdrop as its first path. On our
// own surface that's a no-op rectangle — drop it rather than paint over the panel.
const FULL_CANVAS = /^M0 0h1024v1024H0z$/;

const MAX_DELAY = Math.max(...PLAN_GLYPH.map((p) => p.delay)) || 1;
const ELEMENTS = PLAN_GLYPH.filter((p) => !FULL_CANVAS.test(p.d)).map((p) => ({
  d: p.d,
  role: classify(p.fill),
  t: p.delay / MAX_DELAY, // 0 (centre) → 1 (outer)
}));

const PALETTE: Record<'dark' | 'light', Record<Role, string>> = {
  dark: {
    bg: 'var(--background)',
    ink: '#334680',
    violet: '#8B5CF6',
    teal: '#2DD4BF',
    amber: '#F59E0B',
  },
  light: {
    bg: 'var(--background)',
    ink: '#1E2B5C',
    violet: '#7C3AED',
    teal: '#0D9488',
    amber: '#D97706',
  },
};

export function PlanGlyph({ size = 88, className }: { size?: number; className?: string }) {
  const { shouldAnimate } = useMotion();
  const isDark = useIsDarkTheme();
  const pal = PALETTE[isDark ? 'dark' : 'light'];
  const uid = useId().replace(/:/g, '');
  const glowId = `planglow-${uid}`;
  const fogId = `planfog-${uid}`;
  const SPREAD = 0.65; // seconds from centre to outermost path

  return (
    <svg
      viewBox={PLAN_GLYPH_VIEWBOX}
      width={size}
      height={size}
      className={className}
      role="img"
      aria-hidden="true"
    >
      <defs>
        <radialGradient id={fogId} cx="50%" cy="50%" r="55%">
          <stop offset="0%" stopColor={pal.teal} stopOpacity={isDark ? 0.16 : 0.09} />
          <stop offset="70%" stopColor={pal.violet} stopOpacity={isDark ? 0.07 : 0.04} />
          <stop offset="100%" stopColor={pal.teal} stopOpacity="0" />
        </radialGradient>
        <filter id={glowId} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation={isDark ? 6 : 3} result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Volumetric fog — breathes slowly so an empty plan still reads as "alive". */}
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
            ? { duration: 3.6, repeat: Infinity, ease: 'easeInOut' }
            : { duration: 0.6 }
        }
      />

      {ELEMENTS.map((el, i) => {
        // Negative space (the open node's hole): paint immediately — invisible on
        // the surface, but it carves the ring out of the amber fill drawn under it.
        if (el.role === 'bg') return <path key={i} d={el.d} fill={pal.bg} />;
        const accent = el.role === 'teal' || el.role === 'amber';
        return (
          <motion.path
            key={i}
            d={el.d}
            fill={pal[el.role]}
            filter={accent ? `url(#${glowId})` : undefined}
            style={{ transformOrigin: 'center', transformBox: 'fill-box' }}
            initial={shouldAnimate ? { opacity: 0, scale: 0.6 } : { opacity: 0 }}
            animate={shouldAnimate ? { opacity: 1, scale: 1 } : { opacity: 1 }}
            transition={{ delay: el.t * SPREAD, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          />
        );
      })}
    </svg>
  );
}
