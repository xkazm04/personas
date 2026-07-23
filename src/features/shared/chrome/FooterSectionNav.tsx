import { useCallback, useMemo } from 'react';
import { useSystemStore } from '@/stores/systemStore';
import { useTier } from '@/hooks/utility/interaction/useTier';
import { useSidebarLabels } from '@/i18n/useSidebarTranslation';
import { useTranslation } from '@/i18n/useTranslation';
import { SIDEBAR_SECTIONS, passesGates } from '@/lib/navigation/registry';
import type { SidebarSection } from '@/lib/types/types';

/**
 * Compact section rail for the footer, shown while a fullscreen surface has
 * taken over the app (today: the fleet terminal grid).
 *
 * The grid covers the sidebar, which used to leave exactly one way out —
 * dismiss the grid, *then* navigate. That makes checking on a fleet and then
 * going somewhere else a two-step, and it's why the grid felt like it "covered
 * the whole app". This puts the sections back within reach: pick one and the
 * grid minimizes as you go.
 *
 * Sections come from `SIDEBAR_SECTIONS` — the same registry the sidebar, the
 * content router and the command palette read — through the same `passesGates`
 * tier/dev filter, so this rail cannot drift into offering a section the app
 * won't render. Labels come from `useSidebarLabels`, so it inherits the
 * existing translations with no new keys.
 *
 * Deliberately NOT shown in normal operation: the sidebar is the navigation
 * surface then, and a second permanent one would just be two nav systems
 * disagreeing about which is authoritative.
 */
export function FooterSectionNav() {
  const active = useSystemStore((s) => s.sidebarSection);
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);
  const setGridOpen = useSystemStore((s) => s.fleetSetGridOpen);
  const { isVisible } = useTier();
  const labelOf = useSidebarLabels();
  const { t } = useTranslation();

  const sections = useMemo(
    () =>
      SIDEBAR_SECTIONS.filter((s) =>
        passesGates(s.gates, { isDev: import.meta.env.DEV, isTierVisible: isVisible }),
      ),
    [isVisible],
  );

  // Navigating out of a fullscreen surface has to dismiss it too — otherwise
  // the section change happens invisibly underneath the grid.
  const go = useCallback(
    (id: SidebarSection) => {
      setGridOpen(false);
      setSidebarSection(id);
    },
    [setGridOpen, setSidebarSection],
  );

  return (
    <nav
      data-testid="footer-section-nav"
      aria-label={t.chrome.footer_section_nav_aria}
      className="flex items-center gap-0.5"
    >
      {sections.map((s) => {
        const Icon = s.icon;
        const label = labelOf(s.id, s.label);
        const isActive = active === s.id;
        return (
          <button
            key={s.id}
            type="button"
            data-testid={`footer-section-${s.id}`}
            onClick={() => go(s.id)}
            aria-current={isActive ? 'page' : undefined}
            title={label}
            aria-label={label}
            className={`w-7 h-7 rounded-input flex items-center justify-center transition-colors ${
              isActive
                ? 'text-primary bg-primary/15'
                : 'text-foreground hover:text-foreground hover:bg-secondary/50'
            }`}
          >
            <Icon className="w-4 h-4" aria-hidden="true" />
          </button>
        );
      })}
    </nav>
  );
}
