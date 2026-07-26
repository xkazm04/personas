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
 * All timing/easing lives in `./motionPresets.ts`, never inline here or in a
 * consumer — one file to tune, every motionized surface follows. Three orthogonal
 * layers compose: a one-shot `entrance`, an optional ambient `ambient` loop that
 * starts only *after* the entrance finishes, and an optional `hover` transition on
 * the wrapper group. Ambient loops are accent-only, so traced line-work stays still.
 *
 * Light theme is handled entirely in CSS. Geometry is identical across themes; only
 * fills change, so we emit a `[data-theme^="light"]` override per path rather than
 * reading the theme store — which keeps this a dependency-free catalog primitive and
 * costs no re-render on theme switch. Paths filled `var(--background)` (the tracer's
 * negative space) flip for free.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  AMBIENT_PRESETS,
  ENTRANCE_PRESETS,
  HOVER_PRESETS,
  REDUCED_FADE_DURATION_S,
  REDUCED_FADE_KEYFRAMES,
  ambientStartDelayS,
  type AmbientPresetName,
  type EntrancePresetName,
  type HoverPresetName,
} from './motionPresets';

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
  /** One-shot reveal. See motionPresets.ts. */
  entrance?: EntrancePresetName;
  /**
   * Barely-there loop on the accent paths, starting after the entrance settles.
   * `pulse` implies activity — only use it where work is actually happening.
   */
  ambient?: AmbientPresetName;
  /** Layers a transition on the wrapper group; pair with an interactive parent. */
  hover?: HoverPresetName;
}

export function MotionizedGlyph({
  data,
  viewBox,
  className = 'w-40 h-40',
  glow,
  spread = 1.1,
  entrance = 'staggered-draw',
  ambient,
  hover,
}: Props) {
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

  const enter = ENTRANCE_PRESETS[entrance];
  const amb = ambient ? AMBIENT_PRESETS[ambient] : null;
  const hov = hover ? HOVER_PRESETS[hover] : null;
  const enterDelay = (delay: number) => (enter.stagger ? enter.stagger(delay, spread) : 0);
  const reducedFade = `${cls}-fade ${REDUCED_FADE_DURATION_S}s ${enter.ease} both`;
  // The ambient loop waits for the entrance to finish — sequenced, not overlapped.
  const ambDelay = amb ? ambientStartDelayS(enter, spread) : 0;

  return (
    <svg ref={svgRef} viewBox={viewBox} className={className} aria-hidden role="img">
      <style>{`
        @keyframes ${cls}-in { ${enter.keyframes} }
        @keyframes ${cls}-fade { ${REDUCED_FADE_KEYFRAMES} }
        .${cls}-el { opacity: 0; transform-box: fill-box; transform-origin: 50% 50%; }
        ${entrance === 'draw' ? `.${cls}-el { stroke-dasharray: 1; }` : ''}
        .${cls}-run .${cls}-el { animation: ${cls}-in ${enter.durationS}s ${enter.ease} both; }
${amb ? `        @keyframes ${cls}-amb { ${amb.keyframes} }
        /* The loop is 'forwards', NOT 'both': under 'both' its backwards fill would apply
           the from-state (a dimmed accent) during the start delay and fight the entrance. */
        .${cls}-run .${cls}-amb { animation: ${cls}-in ${enter.durationS}s ${enter.ease} both, ${cls}-amb ${amb.durationS}s ${amb.ease} ${amb.iteration ?? 'infinite'} ${amb.direction ?? 'alternate'} forwards; }` : ''}
${hov ? `        .${cls}-hover { transform-box: fill-box; transform-origin: 50% 50%; transition: transform ${hov.durationS}s ${hov.ease}, opacity ${hov.durationS}s ${hov.ease}; }
        svg:hover > .${cls}-hover { transform: scale(1.03); }` : ''}
        @media (prefers-reduced-motion: reduce) {
          .${cls}-run .${cls}-el { animation: ${reducedFade}; }
${amb ? `          /* ambient loops declare reduced: 'none' — drop the loop entirely */
          .${cls}-run .${cls}-amb { animation: ${reducedFade}; }` : ''}
${hov ? `          svg:hover > .${cls}-hover { transform: none; }` : ''}
        }
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
      {/* Outer group carries the hover transition so it composes over the reveal. */}
      <g className={hov ? `${cls}-hover` : undefined}>
        <g key={runKey} className={`${cls}-run`}>
          {data.map((p, i) => {
            const ci = colorIndex.get(p.fill);
            const accent = isAccent(p.fill);
            // Ambient loops ride the accent paths only — traced line-work stays still.
            const loops = !!amb && (amb.accentOnly ? accent : true);
            const classes = [`${cls}-el`, loops ? `${cls}-amb` : '', ci === undefined ? '' : `${cls}-c${ci}`]
              .filter(Boolean)
              .join(' ');
            return (
              <path
                key={i}
                className={classes}
                // Two comma-separated values when a loop rides along: the entrance's
                // per-path stagger, then the loop's post-entrance start.
                style={{ animationDelay: loops ? `${enterDelay(p.delay)}s, ${ambDelay}s` : `${enterDelay(p.delay)}s` }}
                pathLength={entrance === 'draw' ? 1 : undefined}
                d={p.d}
                fill={p.fill}
                filter={glow && accent ? `url(#${cls}-glow)` : undefined}
              />
            );
          })}
        </g>
      </g>
    </svg>
  );
}
