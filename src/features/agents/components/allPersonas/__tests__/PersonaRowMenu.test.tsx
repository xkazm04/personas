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

  // Round 2 card 9: the row menu announced role="menu" but left focus on the
  // trigger and answered no arrow key.
  it('moves focus into the menu, answers arrows, and Tab closes back to the trigger', () => {
    renderRow();
    const trigger = screen.getByTestId('persona-row-menu-p-1');
    fireEvent.click(trigger);
    const dup = screen.getByTestId('persona-row-duplicate-p-1');
    const exp = screen.getByTestId('persona-row-export-p-1');
    expect(document.activeElement).toBe(dup);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(exp);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Home' });
    expect(document.activeElement).toBe(dup);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Tab' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
