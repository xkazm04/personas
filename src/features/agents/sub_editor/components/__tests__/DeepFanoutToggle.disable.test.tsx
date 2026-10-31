/**
 * AN ENABLED CAPABILITY CAN ALWAYS BE DISABLED.
 *
 * A probe rejection (or a plan downgrade) set available=false and the switch
 * was disabled unconditionally while `on` still read the persisted true, so a
 * persona already fanning out could not be switched back. Pinned: with the
 * flag persisted ON and the probe failing, the switch is enabled and a click
 * writes the parameters WITHOUT deep_fanout; with the flag OFF it stays held.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import type { Persona } from '@/lib/bindings/Persona';

const h = vi.hoisted(() => ({ updatePersona: vi.fn(), probe: vi.fn() }));
vi.mock('@/api/agents/personas', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/agents/personas')>()),
  updatePersona: (...a: unknown[]) => h.updatePersona(...a),
}));
vi.mock('@/api/agents/evolution', () => ({
  probeCliCapabilities: () => h.probe(),
}));

import { DeepFanoutToggle } from '../DeepFanoutToggle';
import { useAgentStore } from '@/stores/agentStore';

const ON = JSON.stringify([{ key: 'deep_fanout', type: 'boolean', value: true }]);
const base = { id: 'p1', name: 'Ada', enabled: true, parameters: ON } as unknown as Persona;

beforeEach(() => {
  h.updatePersona.mockReset();
  h.updatePersona.mockImplementation(async (_id: string, input: { parameters?: string | null }) => ({
    ...base, parameters: input.parameters ?? null,
  }));
  h.probe.mockReset();
  useAgentStore.setState({
    personas: [base],
    selectedPersonaId: 'p1',
    detailCache: { p1: { tools: [], triggers: [] } },
    selectedPersona: { ...base, tools: [], triggers: [] } as never,
  });
});

describe('DeepFanoutToggle availability gate', () => {
  it('lets a persisted-ON flag be switched OFF when the probe fails', async () => {
    h.probe.mockRejectedValue(new Error('ipc down'));
    render(<DeepFanoutToggle personaId="p1" parameters={ON} />);
    await waitFor(() => expect(h.probe).toHaveBeenCalled());
    const sw = screen.getByRole('switch');
    await waitFor(() => expect(sw).not.toBeDisabled());
    fireEvent.click(sw);
    await waitFor(() => expect(h.updatePersona).toHaveBeenCalledTimes(1));
    const written = (h.updatePersona.mock.calls[0]?.[1] as { parameters: string }).parameters;
    expect(written).not.toContain('deep_fanout');
  });

  it('still holds an OFF switch when the plan lacks the capability', async () => {
    h.probe.mockResolvedValue({ deepFanoutAvailable: false });
    render(<DeepFanoutToggle personaId="p1" parameters={null} />);
    await waitFor(() => expect(screen.getByRole('switch')).toBeDisabled());
  });
});

describe('DeepFanoutToggle probe failure copy', () => {
  it('does not claim the plan lacks the capability when the probe itself fails', async () => {
    h.probe.mockRejectedValue(new Error('ipc down'));
    render(<DeepFanoutToggle personaId="p1" parameters={null} />);
    await waitFor(() => expect(h.probe).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByText(/Unavailable on this plan/)).toBeNull();
    expect(screen.getByText(/Couldn't check/)).toBeInTheDocument();
  });

  it('still names the plan when the probe answers no', async () => {
    h.probe.mockResolvedValue({ deepFanoutAvailable: false });
    render(<DeepFanoutToggle personaId="p1" parameters={null} />);
    await waitFor(() => expect(screen.getByText(/Unavailable on this plan/)).toBeInTheDocument());
  });
});
