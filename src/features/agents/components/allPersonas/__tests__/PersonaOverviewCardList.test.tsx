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
    />,
  );
  return onToggleSelect;
}

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
