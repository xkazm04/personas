import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/features/agents/components/PersonaIcon', () => ({ PersonaIcon: () => <span /> }));
vi.mock('../PersonaRowMenu', () => ({ PersonaRowMenu: () => <span /> }));
vi.mock('../VerdictTrendCell', () => ({ VerdictTrendCell: () => <span /> }));

import { usePersonaColumns } from '../PersonaOverviewColumns';
import type { AgentListViewConfig } from '../viewConfig';

const view = {
  connectorFilter: 'all', statusFilter: 'all', healthFilter: 'all', favoriteOnly: false, sortKey: null, sortDirection: 'asc',
} as AgentListViewConfig;

function headerFilters(key: string) {
  function Probe() {
    const cols = usePersonaColumns({
      view, setView: () => {}, selectedIds: new Set(), onToggleSelect: () => {}, isFavorite: () => false,
      toggleFavorite: () => {}, onRowClick: () => {}, isBuilding: () => false, isDraft: () => false,
      healthMap: {}, triggerCounts: {}, lastRunMap: {}, spendMap: new Map(), scoreTrendsMap: {},
      connectorNamesMap: new Map(), allConnectorNames: [], onDuplicate: () => {}, onExport: () => {},
    } as Parameters<typeof usePersonaColumns>[0]);
    const col = cols.find((c) => c.key === key)!;
    return <div data-testid="header">{col.filterComponent ?? <span>{col.label}</span>}</div>;
  }
  render(<Probe />);
  return screen.getByTestId('header');
}

// Round 2 card 7: the health filter was mounted on the Trust header, which
// renders trust tiers, while health is painted by the Status column's badge.
describe('roster column filters sit on the column that renders their value', () => {
  it('Status carries both the lifecycle and the health filter', () => {
    const header = headerFilters('status');
    const triggers = header.querySelectorAll('[aria-haspopup="menu"]');
    expect(triggers).toHaveLength(2);
    fireEvent.click(triggers[1]!);
    expect(screen.getAllByRole('menuitemradio').map((o) => o.textContent)).toContain('Failing');
  });

  it('Trust carries no filter', () => {
    const header = headerFilters('trust');
    expect(header.querySelector('[aria-haspopup="menu"]')).toBeNull();
  });
});
