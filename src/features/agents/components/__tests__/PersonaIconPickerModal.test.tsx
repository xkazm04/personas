import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('@/api/agents/personaIcons', () => ({
  importPersonaIcon: vi.fn(),
  listPersonaIcons: vi.fn().mockResolvedValue(['asset-1']),
  deletePersonaIcon: vi.fn().mockResolvedValue(undefined),
  listImageGenCredentials: vi.fn().mockResolvedValue([]),
  generatePersonaIcon: vi.fn(),
  getPersonaIconGenSpend: vi.fn(),
}));
vi.mock('@/features/agents/components/PersonaIcon', () => ({ PersonaIcon: () => null }));

import { deletePersonaIcon } from '@/api/agents/personaIcons';
import { PersonaIconPickerModal } from '../PersonaIconPickerModal';

beforeEach(() => { vi.mocked(deletePersonaIcon).mockClear(); });

describe('PersonaIconPickerModal custom icon delete', () => {
  it('asks before deleting the stored file, and deletes only after confirming', async () => {
    render(<PersonaIconPickerModal isOpen value="" onChange={vi.fn()} onClose={vi.fn()} />);

    const trash = await screen.findByRole('button', { name: 'Remove icon' });
    fireEvent.click(trash);
    expect(deletePersonaIcon).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(deletePersonaIcon).toHaveBeenCalledWith('asset-1'));
  });

  it('cancelling the confirm keeps the file', async () => {
    render(<PersonaIconPickerModal isOpen value="" onChange={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove icon' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(deletePersonaIcon).not.toHaveBeenCalled();
  });
});

describe('PersonaIconPickerModal delete confirm usage count', () => {
  it('names how many OTHER personas use the icon, excluding the one being edited', async () => {
    const { useAgentStore } = await import('@/stores/agentStore');
    useAgentStore.setState({
      personas: [
        { id: 'me', icon: 'custom-icon:asset-1' },
        { id: 'p2', icon: 'custom-icon:asset-1' },
        { id: 'p3', icon: 'custom-icon:asset-1' },
        { id: 'p4', icon: 'custom-icon:other' },
      ],
    } as never);
    render(<PersonaIconPickerModal isOpen value="custom-icon:asset-1" personaId="me" onChange={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove icon' }));
    expect(await screen.findByText(/Also used by 2 other agents\./)).toBeTruthy();
    useAgentStore.setState({ personas: [] } as never);
  });
});
