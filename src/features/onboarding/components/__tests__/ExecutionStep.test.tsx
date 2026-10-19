import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Bypass IPC token wait.
(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

type StatusHandler = (e: { payload: { execution_id: string; status: string } }) => void;
let handler: StatusHandler | null = null;
vi.mock('@tauri-apps/api/event', () => ({
  listen: (_name: string, h: StatusHandler) => {
    handler = h;
    return Promise.resolve(() => { handler = null; });
  },
}));

const getExecution = vi.fn();
vi.mock('@/api/agents/executions', () => ({
  getExecution: (...a: unknown[]) => getExecution(...a),
}));

const executePersona = vi.fn();
vi.mock('@/stores/agentStore', () => ({
  useAgentStore: (sel: (s: unknown) => unknown) => sel({ executePersona, executionOutput: [] }),
}));

import en from '@/i18n/locales/en.json';
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t: en, tx: (s: string) => s }),
}));

import { ExecutionStep } from '../ExecutionStep';

function mount(onComplete = vi.fn()) {
  render(<ExecutionStep personaId="p1" personaName="Echo" onComplete={onComplete} />);
  fireEvent.click(screen.getByRole('button', { name: en.onboarding.run_agent }));
  return onComplete;
}

describe('ExecutionStep settles a run that ended before the listener attached', () => {
  beforeEach(() => {
    handler = null;
    getExecution.mockReset();
    executePersona.mockReset().mockResolvedValue('e1');
  });

  it('a run already completed when the listener attaches completes the step', async () => {
    getExecution.mockResolvedValue({ id: 'e1', status: 'completed' });
    const onComplete = mount();
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(getExecution).toHaveBeenCalledWith('e1', 'p1');
  });

  it('a run already failed shows the failure and a way to run again', async () => {
    getExecution.mockResolvedValue({ id: 'e1', status: 'failed' });
    const onComplete = mount();
    await waitFor(() => expect(screen.getByTestId('onboarding-execution-retry')).toBeTruthy());
    expect(onComplete).not.toHaveBeenCalled();

    executePersona.mockResolvedValue('e2');
    getExecution.mockResolvedValue({ id: 'e2', status: 'running' });
    fireEvent.click(screen.getByTestId('onboarding-execution-retry'));
    await waitFor(() => expect(executePersona).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByTestId('onboarding-execution-retry')).toBeNull());
  });

  it('a still-running row waits for the event, and the event settles exactly once', async () => {
    getExecution.mockResolvedValue({ id: 'e1', status: 'running' });
    const onComplete = mount();
    await waitFor(() => expect(getExecution).toHaveBeenCalled());
    expect(onComplete).not.toHaveBeenCalled();

    handler?.({ payload: { execution_id: 'other', status: 'completed' } });
    expect(onComplete).not.toHaveBeenCalled();
    handler?.({ payload: { execution_id: 'e1', status: 'completed' } });
    handler?.({ payload: { execution_id: 'e1', status: 'completed' } });
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
  });
});
