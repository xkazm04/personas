import { GLYPH_DIMENSIONS } from '@/features/shared/glyph';
import { DIM_META, PETAL_ANGLES } from '@/features/shared/glyph/dimMeta';
import type { GlyphDimension } from '@/features/shared/glyph';
import { useTranslation } from '@/i18n/useTranslation';
import type { DisplayUseCase } from './displayUseCase';

interface PersonaCrestProps {
  personaName: string;
  useCases: DisplayUseCase[];
  /** Compact (~52px sigil) vs full (~88px sigil + extra stats). */
  variant?: 'compact' | 'full';
  /** Optional element rendered on the right edge — typically the persona-level
   *  default model picker. Wrapped in a `shrink-0` so it doesn't squeeze the
   *  name/stats column. */
  rightSlot?: React.ReactNode;
}

/**
 * Persona summary band used as the header for SigilGrid (variant A+B).
 *
 * Visual: a single union-sigil — every glyph dimension is lit if *any*
 * adopted use case populates it — paired with the persona name + headline
 * counts. This anchors the grid below as belonging to one persona, so the
 * tile sigils read as sub-units rather than peer-of-persona crests.
 *
 * Typography mirrors the project Design.md tokens (typo-section-title for
 * the name, typo-label uppercase for the meta strip).
 */
export function PersonaCrest({ personaName, useCases, variant = 'compact', rightSlot }: PersonaCrestProps) {
  const { t, tx } = useTranslation();
  const totalCount = useCases.length;
  const activeCount = useCases.filter((u) => u.health === 'active').length;
  const attentionCount = useCases.filter((u) => u.health === 'needs-attention').length;
  const pausedCount = useCases.filter((u) => u.health === 'disabled').length;

  // Union of all dimensions touched by any use case.
  const usedDims = new Set<GlyphDimension>();
  for (const uc of useCases) for (const d of uc.dimensions) usedDims.add(d);

  const sigilSize = variant === 'compact' ? 56 : 92;

  return (
    <div className="flex items-center gap-3 px-3 py-2.5 mb-3 rounded-card border border-card-border bg-secondary/40 flex-shrink-0">
      <div className="shrink-0">
        <UnionSigil dims={usedDims} size={sigilSize} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="typo-label uppercase tracking-wider text-foreground/55 shrink-0">{t.agents.use_cases.persona_label}</span>
          <span className="typo-section-title text-foreground truncate">{personaName}</span>
        </div>
        <div className="flex items-center gap-3 mt-1 flex-wrap">
          <span className="typo-data font-mono text-foreground">{totalCount}</span>
          <span className="typo-label uppercase tracking-wider text-foreground/65">{t.agents.use_cases.capabilities_label}</span>
          <span className="typo-caption text-status-success">{tx(t.agents.use_cases.capabilities_active, { count: activeCount })}</span>
          {attentionCount > 0 && (
            <span className="typo-caption text-status-warning">{tx(t.agents.use_cases.capabilities_attention, { count: attentionCount })}</span>
          )}
          {pausedCount > 0 && (
            <span className="typo-caption text-foreground/55">{tx(t.agents.use_cases.capabilities_paused, { count: pausedCount })}</span>
          )}
          <span className="typo-caption text-foreground/45 ml-auto">
            {tx(t.agents.use_cases.dimensions_coverage, { count: usedDims.size })}
          </span>
        </div>
      </div>
      {rightSlot && <div className="shrink-0">{rightSlot}</div>}
    </div>
  );
}

interface UnionSigilProps {
  dims: Set<GlyphDimension>;
  size: number;
}

/**
 * Persona-level summary sigil. Mirrors MiniSigil geometry but renders only
 * the union of dims-used-by-any-use-case (no health, no per-uc decoration)
 * with full dimension colours. Visually distinct from a use-case sigil:
 *   - All present petals at full opacity
 *   - No health ring (this isn't a single capability's state)
 *   - A blue persona-core (matches the chronology core gradient)
 */
function UnionSigil({ dims, size }: UnionSigilProps) {
  const center = size / 2;
  const innerR = size * 0.30;
  const outerR = size * 0.46;
  const coreR = size * 0.20;

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
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="block text-primary">
      <defs>
        <radialGradient id={`persona-crest-core-${size}`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fff" stopOpacity={0.6} />
          <stop offset="55%" stopColor="#60a5fa" stopOpacity={0.4} />
          <stop offset="100%" stopColor="#60a5fa" stopOpacity={0.04} />
        </radialGradient>
      </defs>

      {/* Outer guide */}
      <circle cx={center} cy={center} r={outerR + size * 0.04} fill="none" stroke="currentColor" strokeOpacity={0.18} strokeWidth={1} />
      <circle cx={center} cy={center} r={innerR} fill="none" stroke="currentColor" strokeOpacity={0.07} strokeWidth={1} />

      {/* Petals — all dimensions in the union, full colour */}
      {GLYPH_DIMENSIONS.map((dim) => {
        const angle = PETAL_ANGLES[dim];
        const meta = DIM_META[dim];
        const isPresent = dims.has(dim);
        return (
          <g key={dim} transform={`translate(${center}, ${center}) rotate(${angle})`}>
            <path
              d={wedgePath}
              fill={isPresent ? meta.color : 'transparent'}
              fillOpacity={isPresent ? 0.78 : 0}
              stroke={isPresent ? meta.color : 'currentColor'}
              strokeOpacity={isPresent ? 0.95 : 0.16}
              strokeWidth={isPresent ? 1 : 0.6}
            />
          </g>
        );
      })}

      {/* Core */}
      <circle cx={center} cy={center} r={coreR + 2} fill="none" stroke="currentColor" strokeOpacity={0.16} strokeWidth={1} />
      <circle cx={center} cy={center} r={coreR} fill={`url(#persona-crest-core-${size})`} />
      <circle cx={center} cy={center} r={coreR} fill="none" stroke="currentColor" strokeOpacity={0.55} strokeWidth={1.4} />
    </svg>
  );
}
