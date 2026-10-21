/**
 * No interactive control may live INSIDE a button. The Agents rail button
 * carried the orbit dots as `role="button"` spans, and the Agents nav rows
 * carried the favorite star the same way: a screen reader flattens the inner
 * control into the outer label and Tab order is browser-dependent
 * (axe `nested-interactive`).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

vi.mock('@/hooks/sidebar/useSidebarAgentActivity', () => ({
  useSidebarAgentActivity: () => [
    { id: 'a1', personaId: 'p1', personaName: 'Ada', type: 'exec', label: 'Execution in progress' },
    { id: 'a2', personaId: 'p2', personaName: 'Bo', type: 'lab', label: 'Lab run' },
  ],
}));
vi.mock('@/hooks/sidebar/useBadgeCounts', () => ({
  useBadgeCounts: () => ({ pendingReviewCount: 0, unreadReportCount: 0 }),
}));
vi.mock('@/hooks/sidebar/useWhatsNewIndicator', () => ({
  useWhatsNewIndicator: () => ({ hasUpdate: false, dismiss: () => {} }),
}));

import SidebarLevel1 from '../SidebarLevel1';

const INTERACTIVE = 'button, a[href], input, select, textarea, [role="button"], [tabindex]';

describe('Agents rail', () => {
  it('keeps the orbit dots out of the Agents button', () => {
    render(
      <SidebarLevel1 collapsed={false} disabledSections={new Set()} onMobileDrawerToggle={() => {}} appVersion="" />,
    );
    const dots = screen.getAllByRole('button', { name: /Ada: Execution in progress|Bo: Lab run/ });
    expect(dots).toHaveLength(2);
    for (const dot of dots) expect(dot.parentElement?.closest('button, [role="button"]')).toBeNull();
    const rail = screen.getByTestId('sidebar-personas');
    expect(rail.querySelectorAll(INTERACTIVE)).toHaveLength(0);
  });
});

import { AgentPersonaRow } from '../sections/AgentPersonaRow';

describe('Agents nav persona row', () => {
  it('renders the favorite star beside the select button, not inside it', () => {
    render(
      <AgentPersonaRow
        name="Ada"
        rowClassName="row"
        onSelect={() => {}}
        isActive={false}
        star={{ isFavorite: false, label: 'Add to favorites', onToggle: () => {} }}
        statusDot={null}
      />,
    );
    const star = screen.getByRole('button', { name: 'Add to favorites' });
    const select = screen.getByRole('button', { name: 'Ada' });
    expect(select.querySelectorAll(INTERACTIVE)).toHaveLength(0);
    expect(star.closest('button:not([aria-label="Add to favorites"])')).toBeNull();
  });
});
