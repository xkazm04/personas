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
});
