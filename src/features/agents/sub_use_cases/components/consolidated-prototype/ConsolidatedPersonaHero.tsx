import { useMemo } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { GLYPH_DIMENSIONS, DIM_META, PETAL_ANGLES } from '@/features/shared/glyph';
import type { GlyphDimension } from '@/features/shared/glyph';
import type { DisplayUseCase } from '../recipes-prototype/shared/displayUseCase';

interface ConsolidatedPersonaHeroProps {
  personaName: string;
  useCases: DisplayUseCase[];
  /** Optional right slot — typically a persona-level default model picker. */
  rightSlot?: React.ReactNode;
}

/**
 * Hero-scale persona band for the Consolidated prototype. Larger sigil
 * and stronger typography than PersonaCrest so the persona reads as the
 * focal point of the surface rather than a header decoration.
 *
 * The union sigil lights every dimension that ANY active capability uses,
 * with dimmed but visible petals for dimensions that only paused/attention
 * capabilities reference — so the user can see the persona's full reach
 * even when some capabilities are inactive.
 */
export function ConsolidatedPersonaHero({
  personaName,
  useCases,
  rightSlot,
}: ConsolidatedPersonaHeroProps) {
  const { t, tx } = useTranslation();

  const stats = useMemo(() => {
    const total = useCases.length;
    const active = useCases.filter((u) => u.health === 'active').length;
    const attention = useCases.filter((u) => u.health === 'needs-attention').length;
    const paused = useCases.filter((u) => u.health === 'disabled').length;

    const activeDims = new Set<GlyphDimension>();
    const inactiveDims = new Set<GlyphDimension>();
    for (const uc of useCases) {
      const target = uc.health === 'disabled' ? inactiveDims : activeDims;
      for (const d of uc.dimensions) target.add(d);
    }
    return { total, active, attention, paused, activeDims, inactiveDims };
  }, [useCases]);

  return (
    <div
      className="relative overflow-hidden rounded-modal border border-card-border bg-gradient-to-br from-secondary/55 via-secondary/30 to-secondary/10 shadow-elevation-2"
      style={{
        boxShadow:
          'inset 0 1px 0 rgba(255,255,255,0.05), 0 8px 32px rgba(0,0,0,0.18)',
      }}
    >
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none opacity-70"
        style={{
          background:
            'radial-gradient(ellipse 60% 80% at 12% 50%, rgba(96,165,250,0.10) 0%, transparent 60%),' +
            'radial-gradient(ellipse 50% 60% at 88% 50%, rgba(52,211,153,0.06) 0%, transparent 70%)',
        }}
      />

      <div className="relative flex items-center gap-6 px-6 py-6">
        <div className="shrink-0">
          <HeroUnionSigil
            activeDims={stats.activeDims}
            inactiveDims={stats.inactiveDims}
            size={156}
          />
        </div>

        <div className="flex-1 min-w-0">
          <span className="typo-label uppercase tracking-[0.22em] text-foreground/55">
            {t.agents.use_cases.persona_label}
          </span>
          <h2 className="typo-section-title text-foreground mt-1 truncate font-semibold">
            {personaName}
          </h2>

          <div className="flex items-center gap-3 mt-3 flex-wrap">
            <span className="inline-flex items-baseline gap-1.5">
              <span className="typo-data text-foreground font-mono text-xl">
                {stats.total}
              </span>
              <span className="typo-label uppercase tracking-wider text-foreground/65">
                {t.agents.use_cases.capabilities_label}
              </span>
            </span>
            {stats.active > 0 && (
              <span className="typo-caption text-status-success">
                {tx(t.agents.use_cases.capabilities_active, { count: stats.active })}
              </span>
            )}
            {stats.attention > 0 && (
              <span className="typo-caption text-status-warning">
                {tx(t.agents.use_cases.capabilities_attention, { count: stats.attention })}
              </span>
            )}
            {stats.paused > 0 && (
              <span className="typo-caption text-foreground/55">
                {tx(t.agents.use_cases.capabilities_paused, { count: stats.paused })}
              </span>
            )}
          </div>

          <div className="mt-2 typo-caption text-foreground/55">
            {tx(t.agents.use_cases.dimensions_coverage, {
              count: stats.activeDims.size + stats.inactiveDims.size,
            })}
          </div>
        </div>

        {rightSlot && <div className="shrink-0">{rightSlot}</div>}
      </div>
    </div>
  );
}

interface HeroUnionSigilProps {
  activeDims: Set<GlyphDimension>;
  inactiveDims: Set<GlyphDimension>;
  size: number;
}

/**
 * Hero-scale union sigil. Active dimensions are rendered at full opacity;
 * dimensions used only by paused/attention capabilities are rendered at
 * reduced opacity so the persona's full structural footprint stays visible
 * without overstating its current activity.
 */
function HeroUnionSigil({ activeDims, inactiveDims, size }: HeroUnionSigilProps) {
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

  const gradientId = `hero-union-core-${size}`;
  const haloId = `hero-union-halo-${size}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="block text-primary"
      aria-hidden
    >
      <defs>
        <radialGradient id={gradientId} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fff" stopOpacity={0.7} />
          <stop offset="55%" stopColor="#60a5fa" stopOpacity={0.45} />
          <stop offset="100%" stopColor="#60a5fa" stopOpacity={0.04} />
        </radialGradient>
        <radialGradient id={haloId} cx="50%" cy="50%" r="50%">
          <stop offset="60%" stopColor="#60a5fa" stopOpacity={0} />
          <stop offset="100%" stopColor="#60a5fa" stopOpacity={0.18} />
        </radialGradient>
      </defs>

      <circle cx={center} cy={center} r={size * 0.49} fill={`url(#${haloId})`} />
      <circle
        cx={center}
        cy={center}
        r={outerR + size * 0.045}
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.22}
        strokeWidth={1}
      />
      <circle
        cx={center}
        cy={center}
        r={innerR}
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.09}
        strokeWidth={1}
      />

      {GLYPH_DIMENSIONS.map((dim) => {
        const angle = PETAL_ANGLES[dim];
        const meta = DIM_META[dim];
        const isActive = activeDims.has(dim);
        const isInactive = !isActive && inactiveDims.has(dim);
        const present = isActive || isInactive;
        const fillOpacity = isActive ? 0.85 : isInactive ? 0.35 : 0;
        const strokeOpacity = isActive ? 1 : isInactive ? 0.55 : 0.18;
        return (
          <g
            key={dim}
            transform={`translate(${center}, ${center}) rotate(${angle})`}
          >
            <path
              d={wedgePath}
              fill={present ? meta.color : 'transparent'}
              fillOpacity={fillOpacity}
              stroke={present ? meta.color : 'currentColor'}
              strokeOpacity={strokeOpacity}
              strokeWidth={isActive ? 1.1 : 0.7}
            />
          </g>
        );
      })}

      <circle
        cx={center}
        cy={center}
        r={coreR + 3}
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.18}
        strokeWidth={1}
      />
      <circle cx={center} cy={center} r={coreR} fill={`url(#${gradientId})`} />
      <circle
        cx={center}
        cy={center}
        r={coreR}
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.6}
        strokeWidth={1.5}
      />
    </svg>
  );
}
