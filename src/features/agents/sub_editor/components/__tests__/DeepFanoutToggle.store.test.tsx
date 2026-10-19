/**
 * THE DEEP FAN-OUT SWITCH WRITES THROUGH THE STORE.
 *
 * The toggle persisted through the raw `updatePersona` IPC wrapper, so the
 * store's persona row (whose `parameters` feed this very switch) kept the old
 * value: re-mounting the Settings tab re-read it and showed OFF while the
 * persisted flag was ON. Pinned: after a toggle the store's selected persona
 * carries the written `deep_fanout` parameter, and a re-mount reads ON.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { Persona } from '@/lib/bindings/Persona';

const h = vi.hoisted(() => ({ updatePersona: vi.fn() }));
vi.mock('@/api/agents/personas', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/agents/personas')>()),
  updatePersona: (...a: unknown[]) => h.updatePersona(...a),
}));
vi.mock('@/api/agents/evolution', () => ({
  probeCliCapabilities: async () => ({ deepFanoutAvailable: true }),
}));

import { DeepFanoutToggle } from '../DeepFanoutToggle';
import { useAgentStore } from '@/stores/agentStore';

const base = { id: 'p1', name: 'Ada', enabled: true, parameters: null } as unknown as Persona;

beforeEach(() => {
  h.updatePersona.mockReset();
  h.updatePersona.mockImplementation(async (_id: string, input: { parameters?: string | null }) => ({
    ...base, parameters: input.parameters ?? null,
  }));
  useAgentStore.setState({
    personas: [base],
    selectedPersonaId: 'p1',
    detailCache: { p1: { tools: [], triggers: [] } },
    selectedPersona: { ...base, tools: [], triggers: [] } as never,
  });
});

function Mounted() {
  const parameters = useAgentStore((s) => s.selectedPersona?.parameters ?? null);
  return <DeepFanoutToggle personaId="p1" parameters={parameters} />;
}

describe('DeepFanoutToggle', () => {
  it('lands the written parameter in the store, so a re-mount reads ON', async () => {
    const { unmount } = render(<Mounted />);
    fireEvent.click(screen.getByRole('switch'));
    await waitFor(() => expect(h.updatePersona).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(useAgentStore.getState().selectedPersona?.parameters ?? '').toContain('deep_fanout'),
    );
    unmount();
    render(<Mounted />);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  });
});
