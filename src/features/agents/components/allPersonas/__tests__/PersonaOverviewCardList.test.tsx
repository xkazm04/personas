import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useAgentStore } from '@/stores/agentStore';
import type { Persona } from '@/lib/bindings/Persona';
import { PersonaOverviewCardList } from '../PersonaOverviewCardList';

const persona = {
  id: 'p1', name: 'Mailer', description: null, icon: null, color: null, enabled: true,
  lifecycle: 'active', home_team_id: null, trust_score: 50, created_at: '2026-01-01T00:00:00Z',
  design_context: null, setup_status: 'ready', setup_detail: null,
} as unknown as Persona;

beforeEach(() => {
  act(() => {
    useAgentStore.setState({
      personas: [persona] as never,
      personaHealthMap: {},
      personaTriggerCounts: {},
      personaLastRun: {},
      buildPersonaId: null,
      buildPhase: 'initializing',
    } as never);
  });
});

function renderList(selected: boolean, onToggleSelect = vi.fn()) {
  render(
    <PersonaOverviewCardList
      data={[persona]}
      selectedIds={new Set(selected ? ['p1'] : [])}
      onToggleSelect={onToggleSelect}
      isFavorite={() => false}
      toggleFavorite={() => {}}
      onRowClick={() => {}}
      isDraft={() => false}
      connectorNamesMap={new Map()}
      onDuplicate={onDuplicate}
      onExport={() => {}}
    />,
  );
  return onToggleSelect;
}

const onDuplicate = vi.fn();

// Round 2 card 8: the card list's doc promised a row action menu and the card
// rendered none, so the compact roster could not duplicate or export.
describe('PersonaOverviewCardList row menu', () => {
  it('offers the same Duplicate / Export overflow as the grid row', async () => {
    onDuplicate.mockClear();
    renderList(false);
    fireEvent.click(screen.getByTestId('persona-row-menu-p1'));
    await act(async () => { fireEvent.click(screen.getByTestId('persona-row-duplicate-p1')); });
    expect(onDuplicate).toHaveBeenCalledWith('p1');
    expect(screen.queryByTestId('persona-row-export-p1')).toBeNull();
  });
});

describe('PersonaOverviewCardList selection control', () => {
  it('is a checkbox named after the persona, with its checked state announced', () => {
    renderList(false);
    const box = screen.getByRole('checkbox', { name: 'Mailer' });
    expect(box.getAttribute('aria-checked')).toBe('false');
  });

  it('reports checked when the persona is selected and toggles on click', () => {
    const onToggle = renderList(true);
    const box = screen.getByRole('checkbox', { name: 'Mailer' });
    expect(box.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(box);
    expect(onToggle).toHaveBeenCalledWith('p1');
  });
});
