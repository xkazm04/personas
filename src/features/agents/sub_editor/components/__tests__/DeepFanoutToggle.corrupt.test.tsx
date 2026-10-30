/**
 * A CORRUPT PARAMETERS BLOB IS NEVER REPLACED BY THE TOGGLE.
 *
 * writeDeepFanout fell back to [] when the stored parameters JSON did not
 * parse, then persisted that one-entry array: every other persona parameter
 * was erased by flipping a switch. The same editor treats a corrupt
 * model_profile as recoverable and refuses to save over it. Pinned: an
 * unparseable (or non-array) blob is left untouched, the switch rolls back,
 * and the user is told the change was not saved.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({ updatePersona: vi.fn(), toast: vi.fn() }));
vi.mock('@/stores/agentStore', () => ({
  useAgentStore: (sel: (s: { updatePersona: typeof h.updatePersona }) => unknown) =>
    sel({ updatePersona: h.updatePersona }),
}));
vi.mock('@/api/agents/evolution', () => ({
  probeCliCapabilities: async () => ({ deepFanoutAvailable: true }),
}));
vi.mock('@/lib/silentCatch', () => ({
  silentCatch: () => () => undefined,
  toastCatch: (...a: unknown[]) => (err: unknown) => h.toast(...a, err),
}));

import { DeepFanoutToggle } from '../DeepFanoutToggle';

beforeEach(() => { h.updatePersona.mockReset(); h.toast.mockReset(); h.updatePersona.mockResolvedValue({}); });

describe('DeepFanoutToggle on a corrupt parameters blob', () => {
  it.each([
    ['unparseable', '{"key":"deep_fanout",'],
    ['not an array', '{"temperature":0.2}'],
  ])('does not overwrite an %s blob', async (_label, parameters) => {
    render(<DeepFanoutToggle personaId="p1" parameters={parameters} />);
    fireEvent.click(screen.getByRole('switch'));
    await waitFor(() => expect(h.toast).toHaveBeenCalledTimes(1));
    expect(h.updatePersona).not.toHaveBeenCalled();
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  });

  it('still writes through for a valid array, keeping the other parameters', async () => {
    render(<DeepFanoutToggle personaId="p1" parameters='[{"key":"temperature","value":0.2}]' />);
    fireEvent.click(screen.getByRole('switch'));
    await waitFor(() => expect(h.updatePersona).toHaveBeenCalledTimes(1));
    const written = JSON.parse((h.updatePersona.mock.calls[0]?.[1] as { parameters: string }).parameters);
    expect(written).toEqual([{ key: 'temperature', value: 0.2 }, { key: 'deep_fanout', type: 'boolean', value: true }]);
  });
});
