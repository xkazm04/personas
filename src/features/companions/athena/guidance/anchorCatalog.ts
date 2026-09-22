import type { SidebarSection } from '@/lib/types/types';

/**
 * Allow-listed targets Athena may point her orb at via the ad-hoc `point_at`
 * op (and the multi-step `compose_walkthrough`). This is the **safety
 * boundary**: the model names an `anchorId` from this catalog — never a raw
 * testid — so a hallucinated selector can't drive the orb to an arbitrary
 * (or non-existent, or sensitive) element. The backend mirrors these keys in
 * `dispatcher.rs` (`ANCHOR_IDS`) and rejects anything else.
 *
 * Every entry must point at a **stable, always-rendered, route-level** element
 * reachable by the `z-60` guide overlay — i.e. NOT inside a `BaseModal`
 * (z-10000+), or the glow renders behind it. The `nav_*` anchors target the
 * primary sidebar items, which are present on every route, so Athena can point
 * at them without navigating ("your agents live right here →"). The handful of
 * content anchors carry a `route` so the runner switches to it first.
 *
 * To add an anchor: add a stable `data-testid` to the target and an entry here.
 * The backend allow-list (`generated_anchors.rs`, `GUIDANCE_ANCHORS`) is
 * **code-generated** from this catalog by `scripts/generate-guidance-anchors.mjs`
 * (wired into predev/prebuild), so the two can never drift — no manual Rust
 * edit needed.
 */
export interface GuidanceAnchor {
  /** `data-testid` of the element to ring + park the orb beside. */
  testId: string;
  /** Sidebar route to switch to before pointing (omit for always-visible targets). */
  route?: SidebarSection;
  /**
   * The section a "Take me there" CTA should navigate to when Athena points at
   * this anchor without opening it — set on the `nav_*` anchors (which ring a
   * sidebar button but don't navigate). Content anchors use `route` instead
   * (the runner already takes the user there), so they omit `dest`.
   */
  dest?: SidebarSection;
}

export const ANCHOR_CATALOG: Record<string, GuidanceAnchor> = {
  // Primary sidebar items — always visible, no route switch needed. `dest` is
  // the section their "Take me there" CTA navigates to.
  nav_home: { testId: 'sidebar-home', dest: 'home' },
  nav_overview: { testId: 'sidebar-overview', dest: 'overview' },
  nav_agents: { testId: 'sidebar-personas', dest: 'personas' },
  nav_events: { testId: 'sidebar-events', dest: 'events' },
  nav_connections: { testId: 'sidebar-credentials', dest: 'credentials' },
  nav_templates: { testId: 'sidebar-design-reviews', dest: 'design-reviews' },
  nav_plugins: { testId: 'sidebar-plugins', dest: 'plugins' },
  nav_settings: { testId: 'sidebar-settings', dest: 'settings' },

  // Route-level content containers — carry a route so the surface mounts.
  vault: { testId: 'credential-manager', route: 'credentials' },
  overview_dashboard: { testId: 'overview-page', route: 'overview' },
  templates_gallery: { testId: 'templates-page', route: 'design-reviews' },
  settings_page: { testId: 'settings-page', route: 'settings' },
};

/** Anchor ids Athena may name. Mirrored by the backend `ANCHOR_IDS`. */
export const ANCHOR_IDS = Object.keys(ANCHOR_CATALOG);

export function getAnchor(anchorId: string | null | undefined): GuidanceAnchor | null {
  if (!anchorId) return null;
  return ANCHOR_CATALOG[anchorId] ?? null;
}
