import { CapabilitySigil } from '@/features/shared/glyph/CapabilitySigil';
import type { DisplayUseCase } from '@/features/agents/sub_use_cases/components/recipes-prototype/shared/displayUseCase';

interface CapabilityTabBarProps {
  /** Capabilities to render as tabs. One per capability. Order matches
   *  the source array (caller decides ordering). */
  items: DisplayUseCase[];

  /** Currently active capability id. The matching tab gets the active
   *  treatment (ring + raised brightness); others stay muted. */
  activeId: string | null;

  /** Click handler. Receives the clicked capability's id. */
  onActiveChange: (id: string) => void;

  /** Mini-sigil canvas size in px. Default 72 — large enough to read
   *  petal coverage at a glance, small enough that 5-6 tabs fit on a
   *  single row without scrolling at typical viewports. */
  sigilSize?: number;
}

/**
 * Header tab strip for the per-capability Persona Layout. Each tab is a
 * miniature Capability Sigil (8-petal mini glyph showing the capability's
 * dim coverage) with the capability title below. Click a tab → the parent
 * pivots the hero glyph + left summary to that capability.
 *
 * Replaces the right-side compact-capabilities list that the earlier
 * "All capabilities aggregated" View mode used. Under the new per-cap
 * model, the tab strip IS the capability list; the right side panel
 * goes away and the hero column claims that width back.
 *
 * Visual contract:
 *   - Horizontal row of tabs, scrolls horizontally on overflow rather
 *     than wrapping (a wrapping tab strip would shift the hero glyph
 *     vertically when capabilities are added/removed).
 *   - Active tab: dim-coloured ring + brighter background + bold title.
 *   - Inactive tabs: muted background, hover lifts brightness.
 *   - Title under the sigil truncates at 2 lines to keep the strip a
 *     predictable height.
 *
 * No "All" tab — the user's directive was explicit: default = first
 * capability, no aggregate view. Callers ensure `activeId` matches one
 * of the items on mount.
 */
export function CapabilityTabBar({
  items,
  activeId,
  onActiveChange,
  sigilSize = 72,
}: CapabilityTabBarProps) {
  if (items.length === 0) return null;

  return (
    <div
      role="tablist"
      aria-label="Capabilities"
      className="flex items-stretch gap-2 overflow-x-auto scrollbar-thin py-1"
    >
      {items.map((uc) => {
        const isActive = uc.id === activeId;
        return (
          <button
            key={uc.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onActiveChange(uc.id)}
            title={uc.title}
            className={`group shrink-0 flex flex-col items-center gap-1.5 px-3 py-2 rounded-card border transition-all cursor-pointer ${
              isActive
                ? 'border-primary/45 bg-primary/10 shadow-elevation-1'
                : 'border-card-border/40 bg-secondary/15 hover:bg-secondary/30 hover:border-card-border/70'
            }`}
            style={{ width: sigilSize + 32 }}
          >
            <CapabilitySigil
              uc={uc}
              size={sigilSize}
              isActive={isActive}
              petalStyle="wedge"
            />
            <span
              className={`typo-caption text-center leading-tight line-clamp-2 ${
                isActive ? 'text-foreground font-medium' : 'text-foreground/75 group-hover:text-foreground'
              }`}
              style={{ minHeight: '2.2em' }}
            >
              {uc.title}
            </span>
          </button>
        );
      })}
    </div>
  );
}
