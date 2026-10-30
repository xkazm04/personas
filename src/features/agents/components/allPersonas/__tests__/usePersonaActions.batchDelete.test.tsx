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
  listPersonas: vi.fn(),
}));
vi.mock('@/features/overview/components/BlastRadiusPanel', () => ({
  BlastRadiusPanelLazy: () => <div data-testid="blast-radius" />,
}));

import { archivePersona, bulkDeletePersonas, listPersonas } from '@/api/agents/personas';
import { useToastStore } from '@/stores/toastStore';
import { usePersonaActions } from '../PersonaOverviewActions';

const personas = [
  { id: 'a', name: 'Alpha', trust_origin: 'user' },
  { id: 'b', name: 'Beta', trust_origin: 'user' },
  { id: 'dir', name: 'Director', trust_origin: 'system' },
] as unknown as Persona[];

function Harness({ ids }: { ids: string[] }) {
  const [selected, setSelected] = useState(new Set(ids));
  const a = usePersonaActions({
    personas, selectedIds: selected, setSelectedIds: setSelected,
    deletePersona: vi.fn(), selectPersona: vi.fn(), isDraft: () => false,
  });
  return (
    <>
      <button onClick={a.handleBatchDelete}>go</button>
      <button onClick={() => { void a.handleBatchArchive(); }}>archive</button>
      <ConfirmDestructiveModal {...a.modal} />
    </>
  );
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

const toastMessages = () => useToastStore.getState().toasts.map((t) => ('message' in t ? t.message : ''));

describe('a refresh that fails after the mutation landed', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
    vi.mocked(listPersonas).mockReset();
    vi.mocked(listPersonas).mockRejectedValue(new Error('database is locked'));
  });

  it('does not report a delete that succeeded as a failed delete', async () => {
    vi.mocked(bulkDeletePersonas).mockResolvedValueOnce([
      { id: 'a', status: 'deleted' },
      { id: 'b', status: 'deleted' },
    ] as never);
    render(<Harness ids={['a', 'b']} />);
    fireEvent.click(screen.getByText('go'));
    const input = await screen.findByRole('textbox');
    fireEvent.change(input, { target: { value: '2' } });
    const confirmBtn = screen.getAllByRole('button').find((b) => b.textContent?.trim() === 'Delete')!;
    await act(async () => { fireEvent.click(confirmBtn); });
    await waitFor(() => expect(bulkDeletePersonas).toHaveBeenCalled());
    await waitFor(() => expect(toastMessages().length).toBeGreaterThan(0));
    expect(toastMessages()).not.toContain('Failed to delete personas');
    expect(toastMessages()).toContain('Deleted 2 persona(s)');
  });

  it('still confirms an archive that succeeded', async () => {
    vi.mocked(archivePersona).mockResolvedValue(undefined as never);
    render(<Harness ids={['a', 'b']} />);
    await act(async () => { fireEvent.click(screen.getByText('archive')); });
    await waitFor(() => expect(toastMessages()).toContain('Archived 2 persona(s)'));
  });
});

describe('a selection that holds only the system persona', () => {
  beforeEach(() => { useToastStore.setState({ toasts: [] }); });

  it('says why delete did nothing instead of doing nothing silently', async () => {
    render(<Harness ids={['dir']} />);
    fireEvent.click(screen.getByText('go'));
    expect(bulkDeletePersonas).not.toHaveBeenCalled();
    expect(toastMessages()).toContain("The Director is a system persona and can't be deleted.");
  });
});
