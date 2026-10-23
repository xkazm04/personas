import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import type { PersonaExecution } from '@/lib/types/types';

const getLines = vi.fn();
vi.mock('@/api/agents/executions', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getExecutionLogLines: (...a: unknown[]) => getLines(...a),
}));

import { ReplaySandbox } from '../ReplaySandbox';

const execution = {
  id: 'e1', persona_id: 'p1', duration_ms: 60_000, cost_usd: 0.5, tool_steps: null, input_data: null,
} as unknown as PersonaExecution;

async function settle() {
  await act(async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); });
}

describe('ReplaySandbox cap disclosure', () => {
  it('tells the operator when the log was cut at the replay cap', async () => {
    getLines.mockImplementation(async (_e: string, _p: string, _o: number, limit: number) =>
      Array.from({ length: limit }, (_, i) => `l${i}`));
    render(<ReplaySandbox execution={execution} />);
    await settle();
    expect(screen.getByTestId('replay-capped-notice').textContent).toMatch(/10[,.\s]?000/);
  });

  it('stays silent for a run that fits', async () => {
    getLines.mockResolvedValue(['a', 'b']);
    render(<ReplaySandbox execution={execution} />);
    await settle();
    expect(screen.queryByTestId('replay-capped-notice')).toBeNull();
  });
});
