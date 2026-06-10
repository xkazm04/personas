import { useRef } from 'react';
import { CapabilitySigil } from '@/features/shared/glyph/CapabilitySigil';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
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
 * Keyboard: standard tablist pattern with automatic activation — the
 * active tab is the single tab stop; Left/Right arrows (and Home/End)
 * move selection directly. Tooltip surfaces the full title when the
 * 2-line clamp truncates it.
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
  const { t } = useTranslation();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  if (items.length === 0) return null;

  const activeIdx = items.findIndex((u) => u.id === activeId);

  const moveTo = (idx: number) => {
    const target = items[idx];
    if (!target) return;
    onActiveChange(target.id);
    tabRefs.current[idx]?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent, idx: number) => {
    const last = items.length - 1;
    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault();
        moveTo(idx === last ? 0 : idx + 1);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        moveTo(idx === 0 ? last : idx - 1);
        break;
      case 'Home':
        e.preventDefault();
        moveTo(0);
        break;
      case 'End':
        e.preventDefault();
        moveTo(last);
        break;
    }
  };

  return (
    <div
      role="tablist"
      aria-label={t.agents.use_cases.capabilities_label}
      className="flex items-stretch gap-2 overflow-x-auto scrollbar-thin py-1"
    >
      {items.map((uc, idx) => {
        const isActive = uc.id === activeId;
        // Roving tabindex: the active tab is the one tab stop; if activeId
        // matches nothing, the first tab takes it so the strip stays
        // keyboard-reachable.
        const isTabStop = activeIdx === -1 ? idx === 0 : isActive;
        return (
          <Tooltip key={uc.id} content={uc.title} placement="bottom">
            <button
              ref={(el) => { tabRefs.current[idx] = el; }}
              type="button"
              role="tab"
              aria-selected={isActive}
              tabIndex={isTabStop ? 0 : -1}
              onClick={() => onActiveChange(uc.id)}
              onKeyDown={(e) => handleKeyDown(e, idx)}
              className={`group shrink-0 flex flex-col items-center gap-1.5 px-3 py-2 rounded-card border transition-all cursor-pointer focus-visible:outline-none focus-visible:border-primary/70 ${
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
                  isActive ? 'text-foreground font-medium' : 'text-foreground group-hover:text-foreground'
                }`}
                style={{ minHeight: '2.2em' }}
              >
                {uc.title}
              </span>
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}
