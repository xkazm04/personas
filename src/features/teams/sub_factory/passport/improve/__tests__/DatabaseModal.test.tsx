import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { PersonaCredential } from '@/lib/bindings/PersonaCredential';
import { useToastStore } from '@/stores/toastStore';

import type { AppPassport } from '../../passportModel';
import { DatabaseModal } from '../DatabaseModal';

const neon = { id: 'cred-neon', name: 'Neon prod', serviceType: 'neon' } as PersonaCredential;

vi.mock('@/api/devTools/devTools', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/devTools/devTools')>()),
  listEnvConnectors: vi.fn(async () => []),
  // The write fails the way IPC fails: a serialized AppError object.
  setEnvConnector: vi.fn(async () => { throw { error: 'database is locked', kind: 'Database' }; }),
}));
vi.mock('@/api/vault/credentials', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/vault/credentials')>()),
  listCredentials: vi.fn(async () => [neon]),
  healthcheckCredential: vi.fn(async () => ({ success: true })),
}));

// Only the fields DatabaseModal reads.
const passport = { stack: { persistence: [], environments: undefined } } as AppPassport;

beforeEach(() => { useToastStore.setState({ toasts: [] }); });

describe('DatabaseModal', () => {
  it('a failed connector write reaches the user instead of escaping as an unhandled rejection', async () => {
    render(<DatabaseModal slug="p1" projectName="Proj" passport={passport} onClose={vi.fn()} />);
    const slot = await waitFor(() => {
      const s = document.querySelector('[data-testid="database-modal"] section');
      expect(s).not.toBeNull();
      return s!;
    });
    const buttons = slot.querySelectorAll('button');
    fireEvent.click(buttons[buttons.length - 1]!);
    const pick = await screen.findByRole('button', { name: /Neon prod/ });
    await act(async () => { fireEvent.click(pick); });
    await waitFor(() => expect(useToastStore.getState().toasts.some((t) => t.type === 'error')).toBe(true));
  });
});
