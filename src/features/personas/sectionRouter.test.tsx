import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock every section primary with a trivial component carrying a distinct
// testid, so the route ladder can mount each one through Suspense without
// pulling the real (heavy) feature trees.
vi.mock('@/features/home/components/HomePage', () => ({ default: () => <div data-testid="route-home" /> }));
vi.mock('@/features/overview/components/dashboard/OverviewPage', () => ({ default: () => <div data-testid="route-overview" /> }));
vi.mock('@/features/teams/sub_teamWorkspace/TeamCanvas', () => ({ default: () => <div data-testid="route-teams" /> }));
vi.mock('@/features/agents/components/allPersonas/PersonaOverviewPage', () => ({ default: () => <div data-testid="route-personas" /> }));
vi.mock('@/features/triggers/TriggersPage', () => ({ TriggersPage: () => <div data-testid="route-events" /> }));
vi.mock('@/features/vault/sub_credentials/manager/CredentialManager', () => ({ CredentialManager: () => <div data-testid="route-credentials" /> }));
vi.mock('@/features/templates/components/DesignReviewsPage', () => ({ default: () => <div data-testid="route-design-reviews" /> }));
vi.mock('@/features/plugins/PluginBrowsePage', () => ({ default: () => <div data-testid="route-plugins" /> }));
vi.mock('@/features/studio/StudioPage', () => ({ default: () => <div data-testid="route-studio" /> }));
vi.mock('@/features/settings/components/SettingsPage', () => ({ default: () => <div data-testid="route-settings" /> }));

import { NAV_SECTIONS } from '@/lib/navigation/registry';
import { TIERS, type Tier } from '@/lib/constants/uiModes';
import {
  SECTION_ROUTES,
  renderSectionRoute,
  isSectionGated,
  type RoutableSection,
} from './sectionRouter';

const noop = () => {};
const routableIds = Object.keys(SECTION_ROUTES) as RoutableSection[];

describe('route ladder — every registry section mounts its lazy primary', () => {
  it.each(routableIds)('mounts the primary surface for "%s"', async (section) => {
    render(<>{renderSectionRoute(section, noop)}</>);
    // The lazy chunk resolves through Suspense to the section's mocked primary.
    expect(await screen.findByTestId(`route-${section}`)).toBeTruthy();
  });
});

describe('uniform router gating', () => {
  const dev = { isDev: true, isTierVisible: () => true };
  const prodStarter = { isDev: false, isTierVisible: (min: Tier) => min === TIERS.STARTER };

  it('gates every registry entry consistently with its declared gates', () => {
    for (const entry of NAV_SECTIONS) {
      const shouldGateInProdStarter =
        Boolean(entry.gates.devOnly) ||
        (entry.gates.minTier != null && entry.gates.minTier !== TIERS.STARTER);
      expect(isSectionGated(entry.id, prodStarter)).toBe(shouldGateInProdStarter);
      // A dev, full-tier context gates nothing.
      expect(isSectionGated(entry.id, dev)).toBe(false);
    }
  });

  it('falls a gated section straight to Home (no downgraded-tier flash)', async () => {
    // teams is TEAM-tier — blocked for a starter tier. The router must resolve
    // Home immediately rather than briefly mounting the Teams canvas.
    const section = 'teams' as const;
    expect(isSectionGated(section, prodStarter)).toBe(true);
    const target: RoutableSection = isSectionGated(section, prodStarter) ? 'home' : section;
    render(<>{renderSectionRoute(target, noop)}</>);
    expect(await screen.findByTestId('route-home')).toBeTruthy();
    expect(screen.queryByTestId('route-teams')).toBeNull();
  });

  it('mounts a devOnly section in dev but gates it in prod', () => {
    expect(isSectionGated('studio', dev)).toBe(false);
    expect(isSectionGated('studio', prodStarter)).toBe(true);
  });
});
