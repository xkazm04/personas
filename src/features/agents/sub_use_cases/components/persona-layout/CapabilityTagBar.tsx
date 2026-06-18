import { Power } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { GLYPH_DIMENSIONS } from '@/features/shared/glyph';
import type { DisplayUseCase } from '../recipes-prototype/shared/displayUseCase';

interface CapabilityTagBarProps {
  items: DisplayUseCase[];
  activeId: string | null;
  onActiveChange: (id: string) => void;
  /** Toggle a capability's enabled/paused state (the power button). */
  onToggleEnabled?: (id: string) => void;
}

/**
 * View-mode capability switcher, synced to the template adoption
 * `CapabilityTagSwitcher`: compact name-tags (no mini-sigil image) with a
 * power toggle and a thin segment bar. The adoption "answered/total" count +
 * question stepper map to view-mode **dim coverage** — how many of the eight
 * glyph dimensions the capability touches, with one bar segment per dimension
 * — so the tag still encodes the same information the mini-sigil did.
 */
export function CapabilityTagBar({ items, activeId, onActiveChange, onToggleEnabled }: CapabilityTagBarProps) {
  const { t } = useTranslation();
  if (items.length === 0) return null;
  const total = GLYPH_DIMENSIONS.length;

  return (
    <div
      role="tablist"
      aria-label={t.agents.use_cases.persona_layout_capabilities_heading}
      className="flex items-stretch gap-2 overflow-x-auto scrollbar-thin py-1"
    >
      {items.map((uc) => {
        const isActive = uc.id === activeId;
        const off = uc.health === 'disabled';
        const touched = new Set(uc.dimensions);
        const covered = GLYPH_DIMENSIONS.filter((d) => touched.has(d)).length;
        return (
          <div
            key={uc.id}
            className={`group shrink-0 flex flex-col gap-1.5 px-3 py-2 rounded-card border transition-all min-w-[8.5rem] max-w-[16rem] ${
              isActive
                ? 'border-primary/45 bg-primary/10 shadow-elevation-1'
                : 'border-card-border/40 bg-secondary/15 hover:border-card-border/70'
            } ${off ? 'opacity-55' : ''}`}
          >
            <div className="flex items-center gap-1.5 min-w-0">
              <button
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => onActiveChange(uc.id)}
                title={uc.title}
                className="flex-1 min-w-0 flex items-center gap-2 text-left cursor-pointer focus-visible:outline-none"
              >
                <span
                  className={`flex-1 min-w-0 truncate typo-caption text-foreground ${isActive ? 'font-medium' : ''} ${
                    off ? 'line-through decoration-foreground/40' : ''
                  }`}
                >
                  {uc.title}
                </span>
                <span
                  className={`typo-caption font-mono tabular-nums shrink-0 ${covered === total ? 'text-status-success' : ''}`}
                >
                  {covered}/{total}
                </span>
              </button>
              {onToggleEnabled && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleEnabled(uc.id);
                  }}
                  aria-pressed={!off}
                  title={off ? t.agents.use_cases.activate_capability : t.agents.use_cases.pause_capability}
                  aria-label={off ? t.agents.use_cases.activate_capability : t.agents.use_cases.pause_capability}
                  className={`shrink-0 p-1 rounded-full border transition-colors cursor-pointer ${
                    !off
                      ? 'border-status-success/40 text-status-success hover:bg-status-success/10'
                      : 'border-card-border/50 text-foreground hover:bg-foreground/5'
                  }`}
                >
                  <Power className="w-3 h-3" />
                </button>
              )}
            </div>
            {/* Dim-coverage bar — one segment per glyph dimension (lit = the
                capability touches it). The view-mode analog of the adoption
                question stepper. */}
            <span className="flex items-center gap-0.5" aria-hidden="true">
              {GLYPH_DIMENSIONS.map((dim) => (
                <span
                  key={dim}
                  className={`h-1 flex-1 rounded-full transition-colors ${
                    touched.has(dim) ? 'bg-primary/60' : 'bg-foreground/[0.15]'
                  }`}
                />
              ))}
            </span>
          </div>
        );
      })}
    </div>
  );
}
