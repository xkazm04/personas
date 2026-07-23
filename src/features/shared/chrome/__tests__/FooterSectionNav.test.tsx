/**
 * The footer's section rail exists so a fullscreen surface (the fleet grid)
 * can't strand the user: it covers the sidebar, so this becomes the only way
 * into another module. Two things are worth pinning — that navigating also
 * DISMISSES the surface (otherwise the section changes invisibly underneath
 * it), and that the rail is driven by the shared navigation registry rather
 * than a hand-maintained list that could offer an ungated section.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

const setSidebarSection = vi.fn();
const fleetSetGridOpen = vi.fn();
const state = { sidebarSection: 'personas', setSidebarSection, fleetSetGridOpen };

vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (selector: (s: typeof state) => unknown) => selector(state),
}));

// Builder tier — everything the registry gates on tier is visible.
vi.mock('@/hooks/utility/interaction/useTier', () => ({
  useTier: () => ({ isVisible: () => true, isBuilder: true }),
}));

import { SIDEBAR_SECTIONS } from '@/lib/navigation/registry';
import { FooterSectionNav } from '../FooterSectionNav';

describe('FooterSectionNav', () => {
  beforeEach(() => {
    setSidebarSection.mockReset();
    fleetSetGridOpen.mockReset();
    state.sidebarSection = 'personas';
  });

  it('offers exactly the sections the navigation registry declares reachable', () => {
    render(<FooterSectionNav />);
    // Registry-driven, so adding a section to NAV_SECTIONS lights it up here
    // for free — and a section the router can't reach can never appear.
    for (const s of SIDEBAR_SECTIONS) {
      expect(screen.getByTestId(`footer-section-${s.id}`)).toBeInTheDocument();
    }
    expect(screen.getAllByRole('button')).toHaveLength(SIDEBAR_SECTIONS.length);
  });

  it('dismisses the fullscreen surface as it navigates', async () => {
    render(<FooterSectionNav />);
    await userEvent.click(screen.getByTestId('footer-section-overview'));
    expect(fleetSetGridOpen).toHaveBeenCalledWith(false);
    expect(setSidebarSection).toHaveBeenCalledWith('overview');
  });

  it('marks the current section so the rail reads as navigation, not actions', () => {
    render(<FooterSectionNav />);
    expect(screen.getByTestId('footer-section-personas')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('footer-section-overview')).not.toHaveAttribute('aria-current');
  });

  it('hides sections the current tier cannot reach', async () => {
    vi.resetModules();
    vi.doMock('@/hooks/utility/interaction/useTier', () => ({
      useTier: () => ({ isVisible: () => false, isBuilder: false }),
    }));
    const { FooterSectionNav: Gated } = await import('../FooterSectionNav');
    render(<Gated />);
    // Tier-gated entries (teams / events / plugins) drop out; ungated ones stay.
    expect(screen.queryByTestId('footer-section-teams')).not.toBeInTheDocument();
    expect(screen.getByTestId('footer-section-home')).toBeInTheDocument();
  });
});
