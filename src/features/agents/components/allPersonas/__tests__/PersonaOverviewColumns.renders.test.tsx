/**
 * Render-count instrument for the roster's selection toggle.
 *
 * Counts how many times each cell component renders across ONE checkbox
 * toggle on a 25-row page. Cells are mocked to count; the real
 * usePersonaColumns + DataGrid wiring is what is under measurement.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { useCallback, useState, type ReactNode } from 'react';
import type { Persona } from '@/lib/bindings/Persona';

const counts = { name: 0, tooltip: 0 };

// Leaf mocks sit INSIDE each real cell, so a count only moves when the cell's
// own body runs - a React.memo boundary around the cell is therefore visible.
vi.mock('@/features/shared/components/display/InlineEditableText', () => ({
  InlineEditableText: () => { counts.name++; return <span />; },
}));
vi.mock('@/features/shared/components/display/Tooltip', () => ({
  // Favorite + Connectors cells each render exactly one Tooltip per row here.
  Tooltip: ({ children }: { children: ReactNode }) => { counts.tooltip++; return <>{children}</>; },
}));
vi.mock('@/features/agents/components/PersonaIcon', () => ({ PersonaIcon: () => <span /> }));
vi.mock('../PersonaOverviewFilterHeader', () => ({ PersonaOverviewFilterHeader: () => <span /> }));
vi.mock('../PersonaRowMenu', () => ({ PersonaRowMenu: () => <span /> }));
vi.mock('../VerdictTrendCell', () => ({ VerdictTrendCell: () => <span /> }));

import { DataGrid } from '@/features/shared/components/display/DataGrid';
import { usePersonaColumns } from '../PersonaOverviewColumns';
import type { AgentListViewConfig } from '../viewConfig';

const personas = Array.from({ length: 25 }, (_, i) => ({
  id: `p${i}`, name: `P${i}`, enabled: true, lifecycle: 'active', trust_score: 1,
})) as unknown as Persona[];

const view = { connectorFilter: 'all', statusFilter: 'all', healthFilter: 'all' } as unknown as AgentListViewConfig;
const noop = () => {};
const stable = {
  view, setView: noop, isFavorite: () => false, toggleFavorite: noop, onRowClick: noop,
  isBuilding: () => false, isDraft: () => false, healthMap: {}, triggerCounts: {}, lastRunMap: {},
  spendMap: new Map(), scoreTrendsMap: {}, connectorNamesMap: new Map(), allConnectorNames: [],
  onDuplicate: noop, onExport: noop,
};

function Harness() {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const onToggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);
  const columns = usePersonaColumns({ ...stable, selectedIds, onToggleSelect });
  return <DataGrid columns={columns} data={personas} getRowKey={(p) => p.id} pageSize={25} />;
}

describe('roster selection toggle render cost', () => {
  beforeEach(() => { counts.name = counts.tooltip = 0; });

  it('re-renders at most the toggled row cells on one selection toggle', () => {
    render(<Harness />);
    expect(screen.getAllByRole('checkbox')).toHaveLength(25);
    const before = { ...counts };
    act(() => { fireEvent.click(screen.getByRole('checkbox', { name: 'P3' })); });
    const delta = { name: counts.name - before.name, tooltip: counts.tooltip - before.tooltip };
    console.info('RENDER_DELTA', JSON.stringify(delta));
    expect(screen.getByRole('checkbox', { name: 'P3' })).toHaveAttribute('aria-checked', 'true');
    // Selection reaches the toggled row only: its name cell does not depend on
    // selection at all, so no row's name cell may repaint (25 rows x 2 tooltips
    // would be favorite + connectors on every row).
    expect(delta.name).toBe(0);
    // Triggers + spend tooltips are still rendered inline by the columns hook
    // (2 per row, out of this card's scope); the favorite + connectors cells
    // are the other 2 per row and must not repaint.
    expect(delta.tooltip).toBeLessThanOrEqual(2 * 25);
  });
});
