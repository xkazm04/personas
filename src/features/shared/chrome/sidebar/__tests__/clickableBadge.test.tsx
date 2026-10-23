/**
 * A clickable rail badge (e.g. the What's New dot, dismissed on click) is a
 * control, so it must sit BESIDE its rail button, not inside it. Passive
 * badges may stay inside.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

vi.mock('@/hooks/sidebar/useSidebarAgentActivity', () => ({ useSidebarAgentActivity: () => [] }));
vi.mock('@/hooks/sidebar/useBadgeCounts', () => ({
  useBadgeCounts: () => ({ pendingReviewCount: 2, unreadReportCount: 0 }),
}));
vi.mock('@/hooks/sidebar/useWhatsNewIndicator', () => ({
  useWhatsNewIndicator: () => ({ hasUpdate: true, dismiss: () => {} }),
}));

import SidebarLevel1 from '../SidebarLevel1';

describe('rail badges', () => {
  it('renders a clickable badge beside the rail button, a passive one inside', () => {
    const { container } = render(
      <SidebarLevel1 collapsed={false} disabledSections={new Set()} onMobileDrawerToggle={() => {}} appVersion="" />,
    );
    // The clickable badge is the one that carries the pointer cursor.
    const clickable = container.querySelectorAll<HTMLElement>('span.cursor-pointer');
    expect(clickable.length).toBeGreaterThan(0);
    for (const badge of clickable) {
      expect(badge.closest('button')).toBeNull();
      expect(badge.getAttribute('role')).toBe('button');
    }
    const home = screen.getByTestId('sidebar-home');
    expect(home.querySelectorAll('span.cursor-pointer')).toHaveLength(0);
    // Passive badge (pending reviews on Overview) stays inside its button.
    expect(screen.getByTestId('sidebar-overview').textContent).toContain('2');
  });
});
