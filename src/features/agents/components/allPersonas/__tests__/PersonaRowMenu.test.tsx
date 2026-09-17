import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { Persona } from '@/lib/bindings/Persona';

vi.mock('@/api/agents/personas', () => ({
  duplicatePersona: vi.fn(async () => ({
    id: 'p-copy', name: 'Support bot (Copy)', triggersCopied: 2, subscriptionsCopied: 1,
  })),
  exportPersona: vi.fn(async () => true),
}));

import { PersonaRowMenu } from '../PersonaRowMenu';
import { usePersonaShareActions } from '../PersonaOverviewShareActions';
import { duplicatePersona, exportPersona } from '@/api/agents/personas';
import { useAgentStore } from '@/stores/agentStore';

const persona = { id: 'p-1', name: 'Support bot' } as unknown as Persona;

describe('roster row duplicate / export', () => {
  beforeEach(() => {
    vi.mocked(duplicatePersona).mockClear();
    vi.mocked(exportPersona).mockClear();
    useAgentStore.setState({ fetchPersonas: (async () => {}) as never });
  });

  function renderRow() {
    const { result } = renderHook(() =>
      usePersonaShareActions({ selectedIds: new Set(), setSelectedIds: () => {} }),
    );
    render(
      <PersonaRowMenu
        persona={persona}
        onDuplicate={(id) => result.current.handleDuplicate(id)}
        onExport={(id) => result.current.handleExport(id)}
      />,
    );
  }

  it('duplicates the row it was opened from', async () => {
    renderRow();
    fireEvent.click(screen.getByTestId('persona-row-menu-p-1'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('persona-row-duplicate-p-1'));
    });
    await waitFor(() => expect(duplicatePersona).toHaveBeenCalledWith('p-1'));
  });

  it('exports the row it was opened from', async () => {
    renderRow();
    fireEvent.click(screen.getByTestId('persona-row-menu-p-1'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('persona-row-export-p-1'));
    });
    await waitFor(() => expect(exportPersona).toHaveBeenCalledWith('p-1'));
    expect(duplicatePersona).not.toHaveBeenCalled();
  });
});
