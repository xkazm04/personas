import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PersonaOverviewCompactControls } from '../PersonaOverviewCompactControls';
import { DEFAULT_VIEW_CONFIG } from '../viewConfig';

// Round 2 card 8: sorting and the status/health/connector filters lived only
// in DataGrid headers, so the compact card list had none of them.
describe('PersonaOverviewCompactControls', () => {
  it('offers sort plus the three filters', () => {
    render(<PersonaOverviewCompactControls view={DEFAULT_VIEW_CONFIG} onViewChange={() => {}} allConnectorNames={['Gmail']} />);
    const triggers = screen.getByTestId('roster-compact-controls').querySelectorAll('[aria-haspopup="menu"]');
    expect(triggers).toHaveLength(4);
  });

  it('sorts by the chosen key and direction', () => {
    const onViewChange = vi.fn();
    render(<PersonaOverviewCompactControls view={DEFAULT_VIEW_CONFIG} onViewChange={onViewChange} allConnectorNames={[]} />);
    fireEvent.click(screen.getByRole('button', { name: /^sort$/i }));
    const spendDesc = screen.getAllByRole('menuitemradio').find((o) => /spend, descending/i.test(o.textContent ?? ''))!;
    fireEvent.click(spendDesc);
    expect(onViewChange).toHaveBeenCalledWith(expect.objectContaining({ sortKey: 'spend', sortDirection: 'desc' }));
  });

  it('filters by health', () => {
    const onViewChange = vi.fn();
    render(<PersonaOverviewCompactControls view={DEFAULT_VIEW_CONFIG} onViewChange={onViewChange} allConnectorNames={[]} />);
    fireEvent.click(screen.getByRole('button', { name: /^health$/i }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /failing/i }));
    expect(onViewChange).toHaveBeenCalledWith(expect.objectContaining({ healthFilter: 'failing' }));
  });
});
