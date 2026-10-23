import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const { store } = vi.hoisted(() => ({
  store: {
    personas: [] as Array<{ id: string; home_team_id: string | null; lifecycle: string }>,
    teams: [{ id: 't1', name: 'Alpha', color: null }],
  },
}));

vi.mock('@/stores/agentStore', () => ({
  useAgentStore: (sel: (s: { personas: typeof store.personas }) => unknown) => sel({ personas: store.personas }),
}));
vi.mock('@/stores/pipelineStore', () => {
  const fetchTeams = vi.fn();
  return {
    usePipelineStore: (sel: (s: { teams: typeof store.teams; fetchTeams: () => void }) => unknown) =>
      sel({ teams: store.teams, fetchTeams }),
  };
});

import { PersonaGroupDropRail } from '../PersonaGroupDropRail';

/** The count chip rendered beside an option's label. */
function countOf(label: string): string | null {
  const option = screen.getAllByRole('option').find((o) => o.textContent?.includes(label));
  return option?.querySelector('.font-mono')?.textContent ?? null;
}

describe('PersonaGroupDropRail - counts match the rows the roster lists', () => {
  beforeEach(() => {
    store.personas = [
      { id: 'a', home_team_id: 't1', lifecycle: 'active' },
      { id: 'b', home_team_id: 't1', lifecycle: 'archived' },
      { id: 'c', home_team_id: null, lifecycle: 'active' },
      { id: 'd', home_team_id: null, lifecycle: 'archived' },
    ];
  });

  it('the default view does not count archived personas the roster hides', () => {
    render(<PersonaGroupDropRail />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(countOf('Alpha')).toBe('1');
    expect(countOf('No preference')).toBe('2');
  });

  it('the Archived view counts only the archived personas it lists', () => {
    render(<PersonaGroupDropRail archivedView />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(countOf('Alpha')).toBe('1');
    expect(countOf('No preference')).toBe('2');
  });
});
