import { useId, useState } from 'react';
import { GLYPH_DIMENSIONS } from '@/features/shared/glyph';
import type { GlyphDimension, SigilUseCase } from '@/features/shared/glyph';
import { DIM_META, PETAL_ANGLES } from '@/features/shared/glyph/dimMeta';
import { useGlyphDimText } from '@/features/shared/glyph/persona-sigil';
import { SigilPatternDefs, petalPatternFill } from '@/features/shared/glyph/dimPatterns';

interface CapabilitySigilProps {
  /** Structural: only `title`, `health` and `dimensions` are read. */
  uc: SigilUseCase;
  /** Translated health label for the SVG's aria-label. Caller-computed so the
   *  primitive owns no i18n namespace and no feature view model. */
  healthLabel: string;
  /** CVD-safe appearance — present petals read by texture, not hue alone.
   *  Caller-owned (from `useThemeStore`), mirroring `SigilPetal`'s contract
   *  so this primitive never touches app state. */
  cvdSafe: boolean;
  /** Outer SVG canvas size in px (square). Default 84. */
  size?: number;
  /** Hover state — slightly inflates petal opacity + adds hover ring. */
  isHovered?: boolean;
  /** Selected state — adds active ring + bright core. */
  isActive?: boolean;
}

/**
 * Capability Sigil — the small glyph representing a single use case /
 * capability. One per row in a Persona Layout's grid, one per tab in the
 * capability tab bar, one in the fleet monitor's capability list, and one
 * blown up in the expanded detail view. Same 8-petal geometry as the Persona
 * Sigil; petals lit dimly to show which of the persona's dimensions this
 * capability touches.
 *
 * Visual contract:
 *   - 8 micro-petals as filled wedges at the canonical PETAL_ANGLES
 *     (0/45/.../315°)
 *   - Petals present in `uc.dimensions` glow in their dim colour; absent
 *     petals are reduced to a thin ghost outline
 *   - Centre core is tinted by health: success-green (active), warning-amber
 *     (needs-attention), muted slate (disabled) — all static, no pulse
 *   - Outer health ring encodes state at a glance even before the eye reads
 *     individual petals
 *
 * Readable at 60-100px (grid tile) and 240-320px (level-2 detail). Pure
 * visual — no interaction beyond per-petal hover naming; the parent owns
 * click handlers.
 *
 * There used to be a `petalStyle?: 'wedge' | 'dot'` prop with a ~20-line dot
 * branch. All four call sites passed `"wedge"` explicitly, so the branch had
 * never rendered, and the JSDoc justifying it named two components
 * (`SigilGrid`, `CapabilityCard`) that do not exist. Both are gone; a
 * compact variant, if one is ever wanted, should come back with a live call
 * site attached.
 *
 * This file used to read `useThemeStore` and import the agents feature's
 * `DisplayUseCase` / `getHealthMeta` — a nominally shared primitive depending
 * on app state and on one feature's view model, and invisible to every
 * boundary gate (census `catalog-boundary-escape` and the ESLint rule are both
 * scoped to `shared/components/`, not `shared/glyph/`). Both are now props,
 * matching the contract `SigilPetal` already used for `cvdSafe`: connected
 * wrappers read, the primitive renders.
 */
export function CapabilitySigil({
  uc, healthLabel, cvdSafe, size = 84, isHovered = false, isActive = false,
}: CapabilitySigilProps) {
  const dimText = useGlyphDimText();
  const [hoveredDim, setHoveredDim] = useState<GlyphDimension | null>(null);
  const center = size / 2;
  const present = new Set(uc.dimensions);
  const isDisabled = uc.health === 'disabled';
  const isAttention = uc.health === 'needs-attention';

  const corePct = 0.20;
  const innerPct = 0.30;
  const outerPct = 0.46;

  const coreR = size * corePct;
  const innerR = size * innerPct;
  const outerR = size * outerPct;

  const ringR = outerR + size * 0.04;

  // Wedge petal path — narrow at inner ring, broader near outer ring,
  // tapering at the very tip. Tuned visually to read at 80-100px.
  const wedgePath = (() => {
    const innerHalfW = size * 0.022;
    const midR = (innerR + outerR) / 2;
    const midHalfW = size * 0.062;
    const tipHalfW = size * 0.025;
    return `
      M 0 -${innerR}
      C ${innerHalfW} -${innerR + size * 0.02}, ${midHalfW} -${midR + size * 0.02}, ${tipHalfW} -${outerR}
      L -${tipHalfW} -${outerR}
      C -${midHalfW} -${midR + size * 0.02}, -${innerHalfW} -${innerR + size * 0.02}, 0 -${innerR}
      Z
    `;
  })();

  // SVG ids must be unique per *element instance*, not per (use case, size).
  // Two surfaces render the same capability at the same size on one page
  // (UseCaseRow's SIGIL_SIZE is 72 and CapabilityTabBar's sigilSize defaults
  // to 72), and `url(#id)` resolves to whichever duplicate comes first in
  // document order. It happens to be harmless today only because both copies
  // emit identical stops — but the gradient already varies with `isDisabled`
  // while the id does not, so the id is one prop away from lying. `useId`
  // makes it structurally impossible; the colons React puts in the value are
  // stripped because these ids also travel inside `url(#…)` fragments.
  const instanceId = useId().replace(/:/g, '');
  const coreId = `mini-core-${instanceId}`;
  const uid = instanceId;
  const dimOpacityActive = 0.85;
  const dimOpacityIdle = 0.62;
  const ghostOpacity = 0.16;

  // Health colours ride the status tokens so theme calibration AND the
  // CVD-safe status remap apply to the sigil automatically. The disabled
  // slate stays literal — it's a neutral, not a status.
  const healthColor = isAttention
    ? 'var(--status-warning)'
    : isDisabled
      ? '#94a3b8'
      : 'var(--status-success)';
  const ringStroke = isAttention
    ? 'var(--status-warning)'
    : isDisabled
      ? 'rgb(148 163 184 / 0.4)'
      : 'color-mix(in srgb, var(--status-success) 70%, transparent)';

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="block"
      style={{ opacity: isDisabled ? 0.65 : 1 }}
      aria-label={`${uc.title} — ${healthLabel}`}
    >
      <defs>
        <radialGradient id={coreId} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fff" stopOpacity={isDisabled ? 0.18 : 0.55} />
          <stop offset="55%" style={{ stopColor: healthColor }} stopOpacity={isDisabled ? 0.18 : 0.4} />
          <stop offset="100%" style={{ stopColor: healthColor }} stopOpacity={0.04} />
        </radialGradient>
        {/* CVD-safe mode: dim-tinted textures so present petals read by
            pattern, not hue alone (the eight dim colours include several
            confusable pairs under deuteranopia/protanopia). */}
        {cvdSafe && <SigilPatternDefs uid={uid} />}
      </defs>

      {/* Outer health ring */}
      <circle
        cx={center} cy={center} r={ringR}
        fill="none"
        style={{ stroke: ringStroke }}
        strokeOpacity={isActive ? 0.95 : 0.6}
        strokeWidth={isActive ? 1.6 : 1.2}
        strokeDasharray={isDisabled ? '2 4' : undefined}
      />
      {isHovered && !isAttention && (
        <circle
          cx={center} cy={center} r={ringR + 3}
          fill="none"
          stroke="currentColor"
          strokeOpacity={0.4}
          strokeWidth={1}
          className="text-primary"
        />
      )}

      {/* Inner guide */}
      <circle cx={center} cy={center} r={innerR} fill="none" stroke="currentColor" strokeOpacity={0.07} strokeWidth={1} />

      {/* 8 dimension petals */}
      {GLYPH_DIMENSIONS.map((dim) => {
        const angle = PETAL_ANGLES[dim];
        const meta = DIM_META[dim];
        const isPresent = present.has(dim);
        // Hover-to-name: the <title> gives every petal a never-clipped
        // tooltip (robust at 68px tiles where a styled overlay would
        // overflow) + names it in the a11y tree; the hover brighten gives
        // instant feedback before the OS tooltip appears.
        const isPetalHover = hoveredDim === dim;

        return (
          <g
            key={dim}
            transform={`translate(${center}, ${center}) rotate(${angle})`}
            style={{ pointerEvents: 'all', cursor: 'default' }}
            onMouseEnter={() => setHoveredDim(dim)}
            onMouseLeave={() => setHoveredDim(null)}
          >
            <title>{dimText.label[dim]}</title>
            <path
              d={wedgePath}
              fill={isPresent ? (cvdSafe ? petalPatternFill(dim, uid) : meta.color) : 'transparent'}
              fillOpacity={isPresent ? (cvdSafe ? 1 : isActive || isPetalHover ? dimOpacityActive : dimOpacityIdle) : 0}
              stroke={isPresent ? meta.color : isPetalHover ? meta.color : 'currentColor'}
              strokeOpacity={isPresent ? (isPetalHover ? 1 : 0.85) : isPetalHover ? 0.5 : ghostOpacity}
              strokeWidth={isPresent ? 0.8 : 0.6}
            />
          </g>
        );
      })}

      {/* Core */}
      <circle cx={center} cy={center} r={coreR + 2} fill="none" stroke="currentColor" strokeOpacity={0.12} strokeWidth={1} />
      <circle cx={center} cy={center} r={coreR} fill={`url(#${coreId})`} />
      <circle
        cx={center} cy={center} r={coreR}
        fill="none"
        style={{ stroke: healthColor }}
        strokeOpacity={isActive ? 0.95 : 0.55}
        strokeWidth={1.2}
      />
    </svg>
  );
}
