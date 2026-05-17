import { useMemo, useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { GLYPH_DIMENSIONS } from '@/features/shared/glyph';
import type { GlyphDimension } from '@/features/shared/glyph';
import { GlyphSigilCanvas } from '@/features/agents/components/glyph/GlyphSigilCanvas';
import type { PetalState } from '@/features/agents/components/glyph/glyphLayoutTypes';
import type { DisplayUseCase } from '@/features/agents/sub_use_cases/components/recipes-prototype/shared/displayUseCase';

interface PersonaHeroProps {
  personaName: string;
  useCases: DisplayUseCase[];
  /** Sigil canvas size in px. Defaults to 220 — large enough that
   *  petals stay tappable in view mode without dominating the page. */
  sigilSize?: number;
  /** Optional right slot — typically a persona-level default model picker. */
  rightSlot?: React.ReactNode;
}

const DEFAULT_SIGIL_SIZE = 220;

/**
 * Persona-level hero band — the "Persona Sigil" anchored at the top of a
 * Persona Layout surface. Uses the canonical GlyphSigilCanvas (the same
 * component the scratch flow renders at 640px) so view, adoption, and
 * scratch all share one persona-sigil renderer.
 *
 * In view mode the sigil is read-mostly:
 *   - A petal is `resolved` when any ACTIVE capability touches that dim
 *   - A petal is `idle` when no capability uses that dim, OR when only
 *     paused / needs-attention capabilities reference it (the subtle
 *     inactive-dim differentiation from the earlier prototype is dropped
 *     here so the canonical PetalState vocabulary is enough)
 *   - Hover / click are wired but have no effect yet — view-mode petal
 *     interactivity (a small read-only summary popover) lands in a
 *     follow-up commit
 */
export function PersonaHero({
  personaName,
  useCases,
  sigilSize = DEFAULT_SIGIL_SIZE,
  rightSlot,
}: PersonaHeroProps) {
  const { t, tx } = useTranslation();
  const [hoveredDim, setHoveredDim] = useState<GlyphDimension | null>(null);
  const [activeDim, setActiveDim] = useState<GlyphDimension | null>(null);

  const stats = useMemo(() => {
    const total = useCases.length;
    const active = useCases.filter((u) => u.health === 'active').length;
    const attention = useCases.filter((u) => u.health === 'needs-attention').length;
    const paused = useCases.filter((u) => u.health === 'disabled').length;

    const activeDims = new Set<GlyphDimension>();
    const allDims = new Set<GlyphDimension>();
    for (const uc of useCases) {
      for (const d of uc.dimensions) {
        allDims.add(d);
        if (uc.health !== 'disabled') activeDims.add(d);
      }
    }
    return { total, active, attention, paused, activeDims, allDims };
  }, [useCases]);

  const petalStates = useMemo<Record<GlyphDimension, PetalState>>(() => {
    const out = {} as Record<GlyphDimension, PetalState>;
    for (const dim of GLYPH_DIMENSIONS) {
      out[dim] = stats.activeDims.has(dim) ? 'resolved' : 'idle';
    }
    return out;
  }, [stats.activeDims]);

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
          <GlyphSigilCanvas
            size={sigilSize}
            petalStates={petalStates}
            hoveredDim={hoveredDim}
            activeDim={activeDim}
            onHoverDim={setHoveredDim}
            onClickDim={(d) => setActiveDim((prev) => (prev === d ? null : d))}
          >
            {/* Center is intentionally empty in view mode — petals carry the
             *  meaning and the persona name lives in the side column. */}
            <span aria-hidden />
          </GlyphSigilCanvas>
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
              count: stats.allDims.size,
            })}
          </div>
        </div>

        {rightSlot && <div className="shrink-0">{rightSlot}</div>}
      </div>
    </div>
  );
}
