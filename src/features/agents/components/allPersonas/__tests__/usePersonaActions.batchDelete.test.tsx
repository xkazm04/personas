import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { useState } from 'react';
import { ConfirmDestructiveModal } from '@/features/shared/components/overlays/ConfirmDestructiveModal';
import type { Persona } from '@/lib/bindings/Persona';

vi.mock('@/api/agents/personas', () => ({
  getPersonaBlastRadius: vi.fn().mockResolvedValue([]),
  bulkDeletePersonas: vi.fn().mockResolvedValue([]),
  archivePersona: vi.fn(),
  restorePersona: vi.fn(),
}));
vi.mock('@/features/overview/components/BlastRadiusPanel', () => ({
  BlastRadiusPanelLazy: () => <div data-testid="blast-radius" />,
}));

import { bulkDeletePersonas } from '@/api/agents/personas';
import { usePersonaActions } from '../PersonaOverviewActions';

const personas = [
  { id: 'a', name: 'Alpha', trust_origin: 'user' },
  { id: 'b', name: 'Beta', trust_origin: 'user' },
] as unknown as Persona[];

function Harness({ ids }: { ids: string[] }) {
  const [selected, setSelected] = useState(new Set(ids));
  const a = usePersonaActions({
    personas, selectedIds: selected, setSelectedIds: setSelected,
    deletePersona: vi.fn(), selectPersona: vi.fn(), isDraft: () => false,
  });
  return (<><button onClick={a.handleBatchDelete}>go</button><ConfirmDestructiveModal {...a.modal} /></>);
}

beforeEach(() => { vi.mocked(bulkDeletePersonas).mockClear(); });

describe('batch delete guard', () => {
  it('shows the blast radius and holds the delete until the count is typed', async () => {
    render(<Harness ids={['a', 'b']} />);
    fireEvent.click(screen.getByText('go'));

    expect(await screen.findByTestId('blast-radius')).toBeTruthy();
    const input = screen.getByRole('textbox');
    const confirmBtn = screen.getAllByRole('button').find((b) => b.textContent?.trim() === 'Delete')!;
    fireEvent.click(confirmBtn);
    expect(bulkDeletePersonas).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: '2' } });
    await act(async () => { fireEvent.click(confirmBtn); });
    await waitFor(() => expect(bulkDeletePersonas).toHaveBeenCalledWith(['a', 'b']));
  });
});
