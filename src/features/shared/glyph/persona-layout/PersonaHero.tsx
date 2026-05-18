import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { GLYPH_DIMENSIONS } from '@/features/shared/glyph';
import type { GlyphDimension } from '@/features/shared/glyph';
import { GlyphSigilCanvas } from '@/features/shared/glyph/persona-sigil';
import type { PetalState } from '@/features/shared/glyph/persona-sigil';
import type { DisplayUseCase } from '@/features/agents/sub_use_cases/components/recipes-prototype/shared/displayUseCase';

interface PersonaHeroProps {
  personaName: string;
  useCases: DisplayUseCase[];
  /** Sigil canvas size in px. Default 640 — matches the scratch flow's
   *  GlyphFullLayout / GlyphPrototypeLayout so the persona's main glyph
   *  reads identically across view / adoption / scratch surfaces. */
  sigilSize?: number;
  /** Override petalStates derivation. View mode computes from useCases
   *  (resolved if any active capability uses dim, else idle); adoption
   *  passes a custom map that surfaces `pending` for dims with
   *  unanswered questions. */
  petalStatesOverride?: Record<GlyphDimension, PetalState>;
  /** Click handler for a petal — caller decides what to open / toggle.
   *  Defaults to a no-op highlight. */
  onPetalClick?: (dim: GlyphDimension) => void;
  /** Currently-active dim (e.g. the question card is open on this petal).
   *  Drives the "other petals dim" treatment in GlyphHeroSigil. */
  activeDim?: GlyphDimension | null;
  /** Center overlay rendered inside the sigil's inner core (~58% of size).
   *  Best for small content like a "N questions" count button or short
   *  status text. Larger content should use `wideOverlay`. */
  centerOverlay?: ReactNode;
  /** Wide overlay rendered absolute over the sigil stage. Centered both
   *  axes; can be wider than the sigil itself (capped at min(1280px, 96vw)
   *  by the surrounding container — pass a narrower cap via inline
   *  styling on your content if you want a smaller card). Use this for
   *  the adoption answer card and any panel that needs to span more
   *  horizontal space than the sigil's core box affords.
   *
   *  When set, the wide overlay sits on top of the sigil — petals
   *  underneath are clipped by the overlay's own background. The
   *  centerOverlay (if any) is hidden while the wide overlay is open
   *  so they never compete for the same visual space. */
  wideOverlay?: ReactNode;
  /** Optional content rendered on the right side of the metadata band
   *  (e.g. persona default model picker). */
  metadataRightSlot?: ReactNode;

  /** When true, the persona-name + capabilities band is omitted. View
   *  mode uses this — the leftSlot summary + the sigil itself carry the
   *  identity info, so a separate header band is duplicative. */
  hideMetadataBand?: boolean;
}

const DEFAULT_SIGIL_SIZE = 640;

/**
 * Persona-level hero — the canonical Persona Sigil (8 petals = 8 persona
 * dimensions) at hero scale, anchored at the top of a Persona Layout
 * surface.
 *
 * Layout: metadata band (name + capability counts + dimension coverage)
 * fills the full width above; large sigil sits centered below. Same
 * GlyphSigilCanvas the scratch flow uses at 640px, so view / adoption /
 * scratch render an identical glyph at identical size — what differs is
 * the petalStates derivation and what a petal click does.
 */
export function PersonaHero({
  personaName,
  useCases,
  sigilSize = DEFAULT_SIGIL_SIZE,
  petalStatesOverride,
  onPetalClick,
  activeDim: activeDimProp,
  centerOverlay,
  wideOverlay,
  metadataRightSlot,
  hideMetadataBand,
}: PersonaHeroProps) {
  const { t, tx } = useTranslation();
  const [hoveredDim, setHoveredDim] = useState<GlyphDimension | null>(null);
  const [localActiveDim, setLocalActiveDim] = useState<GlyphDimension | null>(null);
  const activeDim = activeDimProp !== undefined ? activeDimProp : localActiveDim;

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
    if (petalStatesOverride) return petalStatesOverride;
    const out = {} as Record<GlyphDimension, PetalState>;
    for (const dim of GLYPH_DIMENSIONS) {
      out[dim] = stats.activeDims.has(dim) ? 'resolved' : 'idle';
    }
    return out;
  }, [petalStatesOverride, stats.activeDims]);

  const handleClickDim = (d: GlyphDimension) => {
    if (onPetalClick) {
      onPetalClick(d);
      return;
    }
    setLocalActiveDim((prev) => (prev === d ? null : d));
  };

  return (
    <div className="flex flex-col items-stretch gap-6">
      {/* Metadata band — full-width row above the sigil so it never
       *  constrains the sigil's available size. */}
      {!hideMetadataBand && (
      <div
        className="relative overflow-hidden rounded-modal border border-card-border bg-gradient-to-r from-secondary/55 via-secondary/30 to-secondary/55 px-6 py-4"
        style={{
          boxShadow:
            'inset 0 1px 0 rgba(255,255,255,0.05), 0 4px 16px rgba(0,0,0,0.15)',
        }}
      >
        <div
          aria-hidden
          className="absolute inset-0 pointer-events-none opacity-60"
          style={{
            background:
              'radial-gradient(ellipse 35% 90% at 5% 50%, rgba(96,165,250,0.10) 0%, transparent 70%),' +
              'radial-gradient(ellipse 35% 90% at 95% 50%, rgba(52,211,153,0.07) 0%, transparent 70%)',
          }}
        />

        <div className="relative flex items-center gap-6">
          <div className="flex-1 min-w-0">
            <span className="typo-label uppercase tracking-[0.22em] text-foreground/55">
              {t.agents.use_cases.persona_label}
            </span>
            <h2 className="typo-section-title text-foreground mt-0.5 truncate font-semibold">
              {personaName}
            </h2>
          </div>

          <div className="hidden md:flex items-center gap-4 flex-wrap shrink-0">
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
            <span className="typo-caption text-foreground/45 border-l border-card-border pl-4">
              {tx(t.agents.use_cases.dimensions_coverage, {
                count: stats.allDims.size,
              })}
            </span>
          </div>

          {metadataRightSlot && <div className="shrink-0">{metadataRightSlot}</div>}
        </div>

        {/* Narrow screens — counts stack below the name */}
        <div className="md:hidden mt-3 flex items-center gap-3 flex-wrap">
          <span className="inline-flex items-baseline gap-1.5">
            <span className="typo-data text-foreground font-mono text-lg">{stats.total}</span>
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
      </div>
      )}

      {/* Sigil stage — centered, sized at 640px by default (matches scratch).
       *  Stage is `relative` so the wideOverlay can position absolute
       *  over it (extending past the sigil's own width when needed). */}
      <div className="relative flex justify-center items-center py-4 min-h-0">
        <div
          aria-hidden
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'radial-gradient(ellipse 50% 70% at 50% 50%, rgba(96,165,250,0.06) 0%, transparent 70%)',
          }}
        />
        <div className="relative" style={{ width: sigilSize, maxWidth: '100%' }}>
          <GlyphSigilCanvas
            size={sigilSize}
            petalStates={petalStates}
            hoveredDim={hoveredDim}
            activeDim={activeDim}
            onHoverDim={setHoveredDim}
            onClickDim={handleClickDim}
          >
            {/* centerOverlay is hidden while the wide overlay is open
             *  so they never compete for the user's attention. */}
            {!wideOverlay && (centerOverlay ?? <span aria-hidden />)}
            {wideOverlay && <span aria-hidden />}
          </GlyphSigilCanvas>
        </div>

        {/* Wide overlay — positions absolute over the sigil stage, so it
         *  can exceed the sigil's width. Vertical scroll lives inside the
         *  overlay content (the answer card supplies its own max-height
         *  + overflow-y-auto). */}
        {wideOverlay && (
          <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none p-4">
            <div
              className="pointer-events-auto"
              style={{ width: 'min(1280px, 96vw)', maxHeight: '100%' }}
            >
              {wideOverlay}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
