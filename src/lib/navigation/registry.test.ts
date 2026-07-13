import { describe, it, expect } from 'vitest';
import type { SidebarSection } from '@/lib/types/types';
import {
  NAV_SECTIONS,
  SIDEBAR_SECTIONS,
  OVERLAY_SECTIONS,
  navSection,
  passesGates,
  type NavReachability,
} from './registry';
import { SECTIONS as ANALYTICS_SECTIONS } from '@/lib/analytics/navCatalog';
import { sections as SIDEBAR_DATA_SECTIONS } from '@/features/shared/chrome/sidebar/sidebarData';
import { SECTION_ROUTES, isRoutableSection } from '@/features/personas/sectionRouter';
import { TIERS } from '@/lib/constants/uiModes';

/**
 * The independent spec of every `SidebarSection` and its expected reachability.
 * Typed as `Record<SidebarSection, …>` so `tsc` FORCES this map to enumerate
 * the full union — add a union member and this object fails to compile until
 * it (and, by the tests below, every consumer) is updated. This is the anchor
 * that makes the registry's completeness claims runtime-verifiable rather than
 * self-referential.
 */
const EXPECTED_SECTIONS: Record<SidebarSection, NavReachability> = {
  home: 'sidebar',
  overview: 'sidebar',
  teams: 'sidebar',
  personas: 'sidebar',
  events: 'sidebar',
  credentials: 'sidebar',
  'design-reviews': 'sidebar',
  plugins: 'sidebar',
  studio: 'sidebar',
  schedules: 'overlay-only',
  settings: 'sidebar',
};

const REACHABILITIES: readonly NavReachability[] = ['sidebar', 'overlay-only', 'hidden'];

describe('navigation registry — completeness', () => {
  const registeredIds = NAV_SECTIONS.map((e) => e.id);

  // (a) every SidebarSection type member has a registry entry
  it('registers every SidebarSection exactly once', () => {
    expect(new Set(registeredIds).size).toBe(registeredIds.length); // no dupes
    expect([...registeredIds].sort()).toEqual(
      (Object.keys(EXPECTED_SECTIONS) as SidebarSection[]).sort(),
    );
  });

  // (b) every registry entry has a router mapping — except overlay-only ones,
  // which are reached via the title-bar overlay and own no content-router branch.
  it('maps every non-overlay section to a content-router route', () => {
    for (const entry of NAV_SECTIONS) {
      if (entry.reachability === 'overlay-only') {
        expect(isRoutableSection(entry.id)).toBe(false);
        expect(entry.id in SECTION_ROUTES).toBe(false);
      } else {
        expect(isRoutableSection(entry.id)).toBe(true);
        const route = SECTION_ROUTES[entry.id as keyof typeof SECTION_ROUTES];
        expect(route).toBeDefined();
        expect(route.Component).toBeDefined();
        expect(route.boundaryName.length).toBeGreaterThan(0);
      }
    }
  });

  // reverse of (b): SECTION_ROUTES invents nothing the registry doesn't declare
  it('has no content-router route without a registry entry', () => {
    for (const id of Object.keys(SECTION_ROUTES)) {
      const entry = NAV_SECTIONS.find((e) => e.id === id);
      expect(entry).toBeDefined();
      expect(entry!.reachability).not.toBe('overlay-only');
    }
  });

  // (c) every entry is explicitly sidebar / overlay-only / hidden, and matches spec
  it('gives every section an explicit, expected reachability', () => {
    for (const entry of NAV_SECTIONS) {
      expect(REACHABILITIES).toContain(entry.reachability);
      expect(entry.reachability).toBe(EXPECTED_SECTIONS[entry.id]);
    }
  });

  // (d) navCatalog derives from the registry, so analytics CANNOT omit a section
  it('derives the analytics catalog from the registry (no omissions, no extras)', () => {
    expect([...ANALYTICS_SECTIONS]).toEqual(registeredIds);
  });

  // (e) both directions for the sidebar rail: it is exactly the sidebar-reachable
  // registry entries, in registry order — nothing missing, nothing invented.
  it('derives the sidebar rail from the registry in both directions', () => {
    const railIds = SIDEBAR_DATA_SECTIONS.map((s) => s.id);
    const expectedRail = SIDEBAR_SECTIONS.map((e) => e.id);
    expect(railIds).toEqual(expectedRail);
    // Schedules is overlay-only → never in the rail.
    expect(railIds).not.toContain('schedules');
    // Every rail section carries the registry's gates.
    for (const s of SIDEBAR_DATA_SECTIONS) {
      expect(s.minTier).toBe(navSection(s.id).gates.minTier);
      expect(s.devOnly).toBe(navSection(s.id).gates.devOnly);
    }
  });

  it('splits sidebar vs overlay sets without overlap', () => {
    const sidebar = new Set(SIDEBAR_SECTIONS.map((e) => e.id));
    const overlay = new Set(OVERLAY_SECTIONS.map((e) => e.id));
    for (const id of overlay) expect(sidebar.has(id)).toBe(false);
    expect(sidebar.size + overlay.size).toBeLessThanOrEqual(NAV_SECTIONS.length);
    expect(OVERLAY_SECTIONS.map((e) => e.id)).toEqual(['schedules']);
  });
});

describe('navigation registry — gates', () => {
  const dev = { isDev: true, isTierVisible: () => true };
  const prodStarter = {
    isDev: false,
    isTierVisible: (min: typeof TIERS[keyof typeof TIERS]) => min === TIERS.STARTER,
  };

  it('passes ungated sections everywhere', () => {
    expect(passesGates({}, prodStarter)).toBe(true);
    expect(passesGates(navSection('home').gates, prodStarter)).toBe(true);
  });

  it('blocks devOnly sections in non-dev builds', () => {
    expect(passesGates(navSection('studio').gates, dev)).toBe(true);
    expect(passesGates(navSection('studio').gates, prodStarter)).toBe(false);
  });

  it('blocks TEAM-tier sections for a starter tier', () => {
    for (const id of ['teams', 'events', 'plugins'] as const) {
      expect(passesGates(navSection(id).gates, prodStarter)).toBe(false);
      expect(passesGates(navSection(id).gates, dev)).toBe(true);
    }
  });
});
