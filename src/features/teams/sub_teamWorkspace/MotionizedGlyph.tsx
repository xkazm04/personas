/**
 * MotionizedGlyph — generic renderer for a /motionize traced glyph.
 *
 * Maps an emitted `{ d, fill, delay }[]` (from trace.mjs --emit) to a center-out
 * reveal. Opacity always animates (gradual even under reduced motion — a
 * cross-fade is RM-acceptable per the app's motion philosophy); scale/pop only in
 * full motion. Optional `glow` applies an emissive SVG blur to the *bright accent*
 * paths (the cinematic "light comes from objects" look — see ART_STYLE.md), never
 * to dark line-work or the surface-coloured negative space.
 */
import { useId } from 'react';
import { motion } from 'framer-motion';
import { useMotion } from '@/hooks/utility/interaction/useMotion';

export interface GlyphElement { d: string; fill: string; delay: number }

/** Bright accent (violet/teal/amber) vs dark navy line-work: max channel > 0x80. */
function isAccent(fill: string): boolean {
  const m = /^#([0-9a-f]{6})$/i.exec(fill);
  if (!m) return false; // var(--background) etc.
  const n = parseInt(m[1]!, 16);
  return Math.max((n >> 16) & 255, (n >> 8) & 255, n & 255) > 0x80;
}

interface Props {
  data: GlyphElement[];
  viewBox: string;
  className?: string;
  /** Emissive glow on accent paths (cinematic direction). */
  glow?: boolean;
  /** Total reveal spread in seconds (delay 0..1 maps into this). */
  spread?: number;
}

export function MotionizedGlyph({ data, viewBox, className = 'w-40 h-40', glow, spread = 1.1 }: Props) {
  const { shouldAnimate } = useMotion();
  const gid = useId().replace(/:/g, '');

  return (
    <svg viewBox={viewBox} className={className} aria-hidden role="img">
      {glow && (
        <defs>
          <filter id={`glow-${gid}`} x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="7" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
      )}
      {data.map((p, i) => {
        const delay = 0.08 + p.delay * spread;
        return (
          <motion.path
            key={i}
            d={p.d}
            fill={p.fill}
            filter={glow && isAccent(p.fill) ? `url(#glow-${gid})` : undefined}
            initial={shouldAnimate ? { opacity: 0, scale: 0.4 } : { opacity: 0 }}
            animate={shouldAnimate ? { opacity: 1, scale: 1 } : { opacity: 1 }}
            transition={
              shouldAnimate
                ? { opacity: { duration: 0.4, delay }, scale: { type: 'spring', stiffness: 320, damping: 17, delay } }
                : { opacity: { duration: 0.45, delay } }
            }
            style={shouldAnimate ? { transformOrigin: 'center', transformBox: 'fill-box' } : undefined}
          />
        );
      })}
    </svg>
  );
}
