/**
 * MotionizedGlyph — generic renderer for a /motionize traced glyph.
 *
 * Maps an emitted `{ d, fill, delay }[]` (trace.mjs --emit) to a center-out
 * reveal. Deliberately uses **CSS keyframes**, not framer-motion: the app wraps
 * everything in `<MotionConfig reducedMotion={visible ? 'user' : 'always'}>`, and
 * under `always` framer snaps EVERY animation (opacity included) — which silently
 * killed the reveal. CSS animations aren't governed by MotionConfig, so they run
 * reliably; an IntersectionObserver replays them each time the glyph re-enters the
 * viewport (section land / tab switch / scroll-back). Reduced motion keeps the
 * opacity fade, drops the scale (via a media query). Optional emissive `glow` blurs
 * the bright accent paths (cinematic/cyberpunk "light from objects" — see ART_STYLE.md).
 */
import { useEffect, useId, useRef, useState } from 'react';

export interface GlyphElement { d: string; fill: string; delay: number }

/** Bright accent (neon) vs dark navy line-work: max channel > 0x80. */
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
  glow?: boolean;
  /** Total reveal spread in seconds (delay 0..1 maps into this). */
  spread?: number;
}

export function MotionizedGlyph({ data, viewBox, className = 'w-40 h-40', glow, spread = 1.1 }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const gid = useId().replace(/:/g, '');
  // First reveal plays on mount; the observer bumps this to replay on re-entry.
  const [runKey, setRunKey] = useState(1);
  const seen = useRef<boolean | null>(null);

  useEffect(() => {
    const el = svgRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        const vis = entries[0]?.isIntersecting ?? false;
        if (seen.current === null) { seen.current = vis; return; } // initial observation
        if (vis && !seen.current) setRunKey((k) => k + 1);          // re-entered view → replay
        seen.current = vis;
      },
      { threshold: 0.25 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const cls = `mz-${gid}`;

  return (
    <svg ref={svgRef} viewBox={viewBox} className={className} aria-hidden role="img">
      <style>{`
        @keyframes ${cls}-reveal { from { opacity: 0; transform: scale(0.35); } to { opacity: 1; transform: scale(1); } }
        @keyframes ${cls}-fade { from { opacity: 0; } to { opacity: 1; } }
        .${cls}-el { opacity: 0; transform-box: fill-box; transform-origin: 50% 50%; }
        .${cls}-run .${cls}-el { animation: ${cls}-reveal 0.5s both cubic-bezier(0.16, 1, 0.3, 1); }
        @media (prefers-reduced-motion: reduce) { .${cls}-run .${cls}-el { animation-name: ${cls}-fade; animation-duration: 0.45s; } }
      `}</style>
      {glow && (
        <defs>
          <filter id={`${cls}-glow`} x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="7" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
      )}
      <g key={runKey} className={`${cls}-run`}>
        {data.map((p, i) => (
          <path
            key={i}
            className={`${cls}-el`}
            style={{ animationDelay: `${0.08 + p.delay * spread}s` }}
            d={p.d}
            fill={p.fill}
            filter={glow && isAccent(p.fill) ? `url(#${cls}-glow)` : undefined}
          />
        ))}
      </g>
    </svg>
  );
}
