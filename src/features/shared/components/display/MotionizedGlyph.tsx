/**
 * @catalog Traced multi-path SVG glyph that draws itself in with a center-out reveal.
 *
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
 *
 * Light theme is handled entirely in CSS. Geometry is identical across themes; only
 * fills change, so we emit a `[data-theme^="light"]` override per path rather than
 * reading the theme store — which keeps this a dependency-free catalog primitive and
 * costs no re-render on theme switch. Paths filled `var(--background)` (the tracer's
 * negative space) flip for free.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';

export interface GlyphElement { d: string; fill: string; delay: number }
/** A traced glyph module's shape (see src/features/shared/glyph/glyphs/). */
export interface TracedGlyph { viewBox: string; data: GlyphElement[] }

const rgb = (fill: string): [number, number, number] | null => {
  const m = /^#([0-9a-f]{6})$/i.exec(fill);
  if (!m) return null; // var(--background) etc.
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const hex = (c: number[]) => `#${c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;

/** Bright accent (neon) vs dark navy line-work: max channel > 0x80. */
function isAccent(fill: string): boolean {
  const c = rgb(fill);
  return c ? Math.max(c[0], c[1], c[2]) > 0x80 : false;
}

/**
 * Dark→light recolor (ART_STYLE.md § Light / dark): navy ink lifts toward slate so it
 * doesn't read as a hole, and neon accents deepen ~14% because saturated hues vibrate
 * against a light surface. Returns null when the fill needs no override.
 */
function lightFill(fill: string): string | null {
  const c = rgb(fill);
  if (!c) return null;
  const luminance = (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
  if (luminance < 0.22) return hex(c.map((v) => v + (0x33 - v) * 0.35)); // ink → slate
  return hex(c.map((v) => v * 0.86)); // neon → deepened
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

  // One `fill` override per distinct colour, not per path — a 50-path glyph usually
  // carries only a dozen quantized hues. `colorIndex` maps a fill to the class the
  // matching rule targets.
  const { lightRules, colorIndex } = useMemo(() => {
    const idx = new Map<string, number>();
    const rules: string[] = [];
    for (const p of data) {
      if (idx.has(p.fill)) continue;
      const light = lightFill(p.fill);
      if (!light) continue; // var(--background) follows the theme on its own
      rules.push(`[data-theme^="light"] .${cls}-c${idx.size} { fill: ${light}; }`);
      idx.set(p.fill, idx.size);
    }
    return { lightRules: rules.join('\n'), colorIndex: idx };
  }, [data, cls]);

  return (
    <svg ref={svgRef} viewBox={viewBox} className={className} aria-hidden role="img">
      <style>{`
        @keyframes ${cls}-reveal { from { opacity: 0; transform: scale(0.35); } to { opacity: 1; transform: scale(1); } }
        @keyframes ${cls}-fade { from { opacity: 0; } to { opacity: 1; } }
        .${cls}-el { opacity: 0; transform-box: fill-box; transform-origin: 50% 50%; }
        .${cls}-run .${cls}-el { animation: ${cls}-reveal 0.5s both cubic-bezier(0.16, 1, 0.3, 1); }
        @media (prefers-reduced-motion: reduce) { .${cls}-run .${cls}-el { animation-name: ${cls}-fade; animation-duration: 0.45s; } }
${lightRules}
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
        {data.map((p, i) => {
          const ci = colorIndex.get(p.fill);
          return (
            <path
              key={i}
              className={ci === undefined ? `${cls}-el` : `${cls}-el ${cls}-c${ci}`}
              style={{ animationDelay: `${0.08 + p.delay * spread}s` }}
              d={p.d}
              fill={p.fill}
              filter={glow && isAccent(p.fill) ? `url(#${cls}-glow)` : undefined}
            />
          );
        })}
      </g>
    </svg>
  );
}
