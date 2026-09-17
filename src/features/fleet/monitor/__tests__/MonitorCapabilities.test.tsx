/**
 * A capability sigil in the Monitor drawer used to dispatch the charter's own
 * sample and nothing else, which makes the drawer a place to fire fixtures
 * rather than a place to do work.
 *
 * What is asserted is the third argument of `execute_persona` — the payload —
 * because that is the only thing that distinguishes "the operator ran their
 * task" from "the operator replayed a fixture". A test that only checked the
 * call count would pass against the exact defect this closes.
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { PersonaCapability } from '@/lib/personas/capabilities';

const executePersona = vi.fn();

vi.mock('@/api/agents/executions', () => ({
  executePersona: (...a: unknown[]) => executePersona(...a),
}));

vi.mock('@/stores/themeStore', () => ({
  useThemeStore: (selector: (s: unknown) => unknown) => selector({ cvdSafe: false }),
}));

vi.mock('@/features/shared/glyph/CapabilitySigil', () => ({
  CapabilitySigil: () => <span data-testid="sigil" />,
}));

import { MonitorCapabilities } from '../MonitorCapabilities';
import { formatSampleForEditing } from '../MonitorRunSheet';

const CAP = {
  id: 'uc-triage',
  title: 'Triage inbox',
  mode: 'e2e',
  health: 'active',
  connector: 'gmail',
  charter: null,
  raw: { sample_input: { ticket: 'T-1' } },
} as unknown as PersonaCapability;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('formatSampleForEditing', () => {
  it('pretty-prints JSON and leaves anything else verbatim', () => {
    expect(formatSampleForEditing('{"a":1}')).toBe('{\n  "a": 1\n}');
    expect(formatSampleForEditing('not json')).toBe('not json');
    expect(formatSampleForEditing(undefined)).toBe('');
  });
});

describe('MonitorCapabilities', () => {
  it('prompts before dispatching and sends what the operator typed', async () => {
    executePersona.mockResolvedValue({ id: 'exec-1' });
    render(<MonitorCapabilities personaId="p-1" useCases={[CAP]} />);

    fireEvent.click(screen.getByText('Triage inbox').closest('button')!);
    // Nothing is dispatched by the click itself.
    expect(executePersona).not.toHaveBeenCalled();

    const field = screen.getByTestId('monitor-run-input') as HTMLTextAreaElement;
    expect(field.value).toBe('{\n  "ticket": "T-1"\n}');

    fireEvent.change(field, { target: { value: '{"ticket":"T-999"}' } });
    fireEvent.click(screen.getByTestId('monitor-run-confirm'));

    await waitFor(() => expect(executePersona).toHaveBeenCalledTimes(1));
    expect(executePersona.mock.calls[0]).toEqual(['p-1', undefined, '{"ticket":"T-999"}', 'uc-triage']);
  });

  it('keeps the sample-only path as an explicit second action', async () => {
    executePersona.mockResolvedValue({ id: 'exec-1' });
    render(<MonitorCapabilities personaId="p-1" useCases={[CAP]} />);

    fireEvent.click(screen.getByText('Triage inbox').closest('button')!);
    fireEvent.change(screen.getByTestId('monitor-run-input'), { target: { value: 'edited away' } });
    fireEvent.click(screen.getByTestId('monitor-run-sample'));

    await waitFor(() => expect(executePersona).toHaveBeenCalledTimes(1));
    expect(executePersona.mock.calls[0][2]).toBe('{"ticket":"T-1"}');
  });

  it('cancelling dispatches nothing and leaves the sigil pressable', () => {
    render(<MonitorCapabilities personaId="p-1" useCases={[CAP]} />);

    fireEvent.click(screen.getByText('Triage inbox').closest('button')!);
    fireEvent.click(screen.getByText('Cancel').closest('button')!);

    expect(executePersona).not.toHaveBeenCalled();
    expect(screen.queryByTestId('monitor-run-sheet')).toBeNull();
    expect(screen.getByText('Triage inbox').closest('button')!.hasAttribute('disabled')).toBe(false);
  });

  it('flags a non-JSON payload without blocking it', () => {
    render(<MonitorCapabilities personaId="p-1" useCases={[CAP]} />);
    fireEvent.click(screen.getByText('Triage inbox').closest('button')!);

    expect(screen.queryByTestId('monitor-run-json-warning')).toBeNull();
    fireEvent.change(screen.getByTestId('monitor-run-input'), { target: { value: 'just words' } });
    expect(screen.getByTestId('monitor-run-json-warning')).toBeTruthy();
    expect(screen.getByTestId('monitor-run-confirm').hasAttribute('disabled')).toBe(false);
  });
});
