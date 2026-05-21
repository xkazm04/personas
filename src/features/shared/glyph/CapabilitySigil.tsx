import { GLYPH_DIMENSIONS } from '@/features/shared/glyph';
import { DIM_META, PETAL_ANGLES } from '@/features/shared/glyph/dimMeta';
import { useTranslation } from '@/i18n/useTranslation';
import {
  getHealthMeta,
  type DisplayUseCase,
} from '@/features/agents/sub_use_cases/components/recipes-prototype/shared/displayUseCase';

interface CapabilitySigilProps {
  uc: DisplayUseCase;
  /** Outer SVG canvas size in px (square). Default 84. */
  size?: number;
  /** Hover state — slightly inflates petal opacity + adds hover ring. */
  isHovered?: boolean;
  /** Selected state — adds active ring + bright core. */
  isActive?: boolean;
  /** Render petals as filled wedges instead of dots. Used by SigilGrid variant
   *  for a more organic, sigil-like read. CapabilityCard uses dots (compact). */
  petalStyle?: 'wedge' | 'dot';
}

/**
 * Shared mini-sigil rendering used by both grid variants.
 *
 * Visual contract:
 *   - 8 micro-petals at the canonical PETAL_ANGLES (0/45/.../315°)
 *   - Petals present in `uc.dimensions` glow in their dim colour; absent
 *     petals are reduced to a thin ghost outline at 18% opacity
 *   - Centre core is tinted by health: success-green (active), amber + faint
 *     pulse (needs-attention), muted slate (disabled)
 *   - Outer health ring encodes state at a glance even before the eye reads
 *     individual petals
 *
 * Designed to be readable at 60-100px (grid tile) and 240-320px (level-2
 * detail). Pure visual — no interaction; the parent owns click handlers.
 */
/**
 * Capability Sigil — the small glyph representing a single use case /
 * capability. One per row in a Persona Layout's grid. Same 8-petal
 * geometry as the Persona Sigil; petals lit dimly to show which of the
 * persona's dimensions this capability touches.
 *
 * Pure visual — no interaction. Parent owns click handlers.
 */
export function CapabilitySigil({
  uc, size = 84, isHovered = false, isActive = false, petalStyle = 'wedge',
}: CapabilitySigilProps) {
  const { t } = useTranslation();
  const center = size / 2;
  const present = new Set(uc.dimensions);
  const isDisabled = uc.health === 'disabled';
  const isAttention = uc.health === 'needs-attention';
  const health = getHealthMeta(t)[uc.health];

  const corePct = 0.20;
  const innerPct = 0.30;
  const outerPct = 0.46;
  const petalDotPct = 0.045;

  const coreR = size * corePct;
  const innerR = size * innerPct;
  const outerR = size * outerPct;
  const petalDotR = size * petalDotPct;

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

  const coreId = `mini-core-${uc.id}-${size}`;
  const dimOpacityActive = 0.85;
  const dimOpacityIdle = 0.62;
  const ghostOpacity = 0.16;

  const ringStroke = isAttention
    ? '#fbbf24'
    : isDisabled
      ? 'rgb(148 163 184 / 0.4)'
      : 'rgb(52 211 153 / 0.7)';

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="block"
      style={{ opacity: isDisabled ? 0.65 : 1 }}
      aria-label={`${uc.title} — ${health.label}`}
    >
      <defs>
        <radialGradient id={coreId} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fff" stopOpacity={isDisabled ? 0.18 : 0.55} />
          <stop offset="55%" stopColor={isAttention ? '#fbbf24' : isDisabled ? '#94a3b8' : '#34d399'} stopOpacity={isDisabled ? 0.18 : 0.4} />
          <stop offset="100%" stopColor={isAttention ? '#fbbf24' : isDisabled ? '#94a3b8' : '#34d399'} stopOpacity={0.04} />
        </radialGradient>
      </defs>

      {/* Outer health ring */}
      <circle
        cx={center} cy={center} r={ringR}
        fill="none"
        stroke={ringStroke}
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

        if (petalStyle === 'wedge') {
          return (
            <g key={dim} transform={`translate(${center}, ${center}) rotate(${angle})`}>
              <path
                d={wedgePath}
                fill={isPresent ? meta.color : 'transparent'}
                fillOpacity={isPresent ? (isActive ? dimOpacityActive : dimOpacityIdle) : 0}
                stroke={isPresent ? meta.color : 'currentColor'}
                strokeOpacity={isPresent ? 0.85 : ghostOpacity}
                strokeWidth={isPresent ? 0.8 : 0.6}
              />
            </g>
          );
        }
        // Dot style — render petals as small circles at the canonical position
        const rad = ((angle - 90) * Math.PI) / 180;
        const x = center + (innerR + (outerR - innerR) * 0.55) * Math.cos(rad);
        const y = center + (innerR + (outerR - innerR) * 0.55) * Math.sin(rad);
        return (
          <circle
            key={dim}
            cx={x}
            cy={y}
            r={petalDotR}
            fill={isPresent ? meta.color : 'currentColor'}
            fillOpacity={isPresent ? (isActive ? dimOpacityActive : dimOpacityIdle) : ghostOpacity}
          />
        );
      })}

      {/* Core */}
      <circle cx={center} cy={center} r={coreR + 2} fill="none" stroke="currentColor" strokeOpacity={0.12} strokeWidth={1} />
      <circle cx={center} cy={center} r={coreR} fill={`url(#${coreId})`} />
      <circle
        cx={center} cy={center} r={coreR}
        fill="none"
        stroke={isAttention ? '#fbbf24' : isDisabled ? '#94a3b8' : '#34d399'}
        strokeOpacity={isActive ? 0.95 : 0.55}
        strokeWidth={1.2}
      />
    </svg>
  );
}

interface EmptyCapabilitySigilProps {
  size?: number;
  isHovered?: boolean;
}

/** Ghost-version of CapabilitySigil rendered in empty grid slots. Same
 *  canonical geometry, all petals at ghost opacity, dashed ring, faint
 *  plus glyph at centre. Used by both variants so empty cells feel like
 *  the same family. */
export function EmptyCapabilitySigil({ size = 84, isHovered = false }: EmptyCapabilitySigilProps) {
  const center = size / 2;
  const innerR = size * 0.30;
  const outerR = size * 0.46;
  const ringR = outerR + size * 0.04;
  const dotR = size * 0.045;

  const innerHalfW = size * 0.022;
  const midR = (innerR + outerR) / 2;
  const midHalfW = size * 0.062;
  const tipHalfW = size * 0.025;
  const wedgePath = `
    M 0 -${innerR}
    C ${innerHalfW} -${innerR + size * 0.02}, ${midHalfW} -${midR + size * 0.02}, ${tipHalfW} -${outerR}
    L -${tipHalfW} -${outerR}
    C -${midHalfW} -${midR + size * 0.02}, -${innerHalfW} -${innerR + size * 0.02}, 0 -${innerR}
    Z
  `;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={`block transition-colors ${isHovered ? 'text-primary' : 'text-foreground'}`}>
      <circle
        cx={center} cy={center} r={ringR}
        fill="none"
        stroke="currentColor"
        strokeOpacity={isHovered ? 0.6 : 0.3}
        strokeWidth={1}
        strokeDasharray="3 4"
      />
      <circle cx={center} cy={center} r={innerR} fill="none" stroke="currentColor" strokeOpacity={0.06} strokeWidth={1} />
      {GLYPH_DIMENSIONS.map((dim) => {
        const angle = PETAL_ANGLES[dim];
        const rad = ((angle - 90) * Math.PI) / 180;
        const x = center + (innerR + (outerR - innerR) * 0.55) * Math.cos(rad);
        const y = center + (innerR + (outerR - innerR) * 0.55) * Math.sin(rad);
        return (
          <g key={dim} transform={`translate(${center}, ${center}) rotate(${angle})`} opacity={0}>
            <path d={wedgePath} fill="none" />
            <g transform={`translate(${x - center}, ${y - center})`} />
          </g>
        );
      })}
      {/* Render dots regardless of style for consistency */}
      {GLYPH_DIMENSIONS.map((dim) => {
        const angle = PETAL_ANGLES[dim];
        const rad = ((angle - 90) * Math.PI) / 180;
        const x = center + (innerR + (outerR - innerR) * 0.55) * Math.cos(rad);
        const y = center + (innerR + (outerR - innerR) * 0.55) * Math.sin(rad);
        return (
          <circle
            key={`d-${dim}`}
            cx={x} cy={y} r={dotR}
            fill="currentColor"
            fillOpacity={isHovered ? 0.25 : 0.12}
          />
        );
      })}
      {/* Plus glyph at centre */}
      <line
        x1={center - size * 0.07} y1={center}
        x2={center + size * 0.07} y2={center}
        stroke="currentColor"
        strokeOpacity={isHovered ? 0.9 : 0.45}
        strokeWidth={1.6}
        strokeLinecap="round"
      />
      <line
        x1={center} y1={center - size * 0.07}
        x2={center} y2={center + size * 0.07}
        stroke="currentColor"
        strokeOpacity={isHovered ? 0.9 : 0.45}
        strokeWidth={1.6}
        strokeLinecap="round"
      />
    </svg>
  );
}
