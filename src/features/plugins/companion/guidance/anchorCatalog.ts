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
 * To add an anchor: add a stable `data-testid` to the target, add an entry
 * here, and add the same key to `ANCHOR_IDS` in the backend dispatcher.
 */
export interface GuidanceAnchor {
  /** `data-testid` of the element to ring + park the orb beside. */
  testId: string;
  /** Sidebar route to switch to before pointing (omit for always-visible targets). */
  route?: SidebarSection;
}

export const ANCHOR_CATALOG: Record<string, GuidanceAnchor> = {
  // Primary sidebar items — always visible, no route switch needed.
  nav_home: { testId: 'sidebar-home' },
  nav_overview: { testId: 'sidebar-overview' },
  nav_agents: { testId: 'sidebar-personas' },
  nav_events: { testId: 'sidebar-events' },
  nav_connections: { testId: 'sidebar-credentials' },
  nav_templates: { testId: 'sidebar-design-reviews' },
  nav_plugins: { testId: 'sidebar-plugins' },
  nav_settings: { testId: 'sidebar-settings' },

  // Route-level content containers — carry a route so the surface mounts.
  vault: { testId: 'credential-manager', route: 'credentials' },
  overview_dashboard: { testId: 'overview-page', route: 'overview' },
};

/** Anchor ids Athena may name. Mirrored by the backend `ANCHOR_IDS`. */
export const ANCHOR_IDS = Object.keys(ANCHOR_CATALOG);

export function getAnchor(anchorId: string | null | undefined): GuidanceAnchor | null {
  if (!anchorId) return null;
  return ANCHOR_CATALOG[anchorId] ?? null;
}
