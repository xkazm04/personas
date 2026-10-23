import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import type { Persona } from '@/lib/bindings/Persona';

const listPersonas = vi.fn();
const resolveEffectiveConfigBulk = vi.fn();
vi.mock('@/api/agents/personas', () => ({
  listPersonas: (...a: unknown[]) => listPersonas(...a),
  resolveEffectiveConfigBulk: (...a: unknown[]) => resolveEffectiveConfigBulk(...a),
}));

import { PersonaConfigPanel } from '../PersonaConfigPanel';

const persona = (id: string, name: string) =>
  ({ id, name, design_context: null }) as unknown as Persona; // only the fields the panel reads

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe('PersonaConfigPanel - load', () => {
  beforeEach(() => {
    listPersonas.mockReset();
    resolveEffectiveConfigBulk.mockReset();
    resolveEffectiveConfigBulk.mockResolvedValue([]);
  });

  it('a superseded load cannot overwrite the rows of the newer one', async () => {
    const first = deferred<Persona[]>();
    listPersonas.mockReturnValueOnce(first.promise).mockResolvedValueOnce([persona('p-new', 'Fresh agent')]);
    // StrictMode runs the mount effect twice: two overlapping loads, and the
    // second (newer) one lands first. The Refresh button is disabled while a
    // load runs, so this double mount is the race the guard exists for.
    render(<StrictMode><PersonaConfigPanel /></StrictMode>);
    await waitFor(() => expect(screen.getByText('Fresh agent')).toBeTruthy());

    await act(async () => { first.resolve([persona('p-old', 'Stale agent')]); });
    expect(screen.queryByText('Stale agent')).toBeNull();
    expect(screen.getByText('Fresh agent')).toBeTruthy();
  });

  it('says the read failed instead of claiming there are no agents', async () => {
    // invokeWithTimeout rejects with a serialized AppError object, not an Error.
    listPersonas.mockRejectedValue({ error: 'database is locked', kind: 'database' });
    render(<PersonaConfigPanel />);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).not.toBe('');
    expect(alert.textContent).not.toContain('[object Object]');
    expect(screen.queryByText('No agents found')).toBeNull();
  });

  it('the Refresh control is busy and inert while a load runs, then re-arms', async () => {
    const pending = deferred<Persona[]>();
    listPersonas.mockReturnValueOnce(pending.promise);
    render(<PersonaConfigPanel />);
    const refresh = screen.getByRole('button', { name: /refresh/i }) as HTMLButtonElement;
    expect(refresh.disabled).toBe(true);
    await act(async () => { pending.resolve([persona('p-1', 'One')]); });
    await waitFor(() => expect((screen.getByRole('button', { name: /refresh/i }) as HTMLButtonElement).disabled).toBe(false));
  });

  it('names an untitled capability in the app language, not hardcoded English', async () => {
    const { useI18nStore } = await import('@/stores/i18nStore');
    const { preloadSectionsAsync } = await import('@/i18n/useTranslation');
    const before = useI18nStore.getState().language;
    await preloadSectionsAsync('de', ['agents', 'settings']);
    useI18nStore.setState({ language: 'de' });
    try {
      const p = { ...persona('p-cap', 'Capable'), design_context: JSON.stringify({ useCases: [{ id: 'uc-a' }] }) } as Persona;
      listPersonas.mockResolvedValue([p]);
      render(<PersonaConfigPanel />);
      const expand = await screen.findByRole('button', { expanded: false });
      act(() => { expand.click(); });
      expect(await screen.findByText('Fähigkeit 1')).toBeTruthy();
      expect(screen.queryByText('Capability 1')).toBeNull();
    } finally {
      useI18nStore.setState({ language: before });
    }
  });
});
