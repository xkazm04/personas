import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ApiPlayground } from './ApiPlayground';

const executePersona = vi.hoisted(() => vi.fn());
const getExecution = vi.hoisted(() => vi.fn());
vi.mock('@/api/agents/executions', () => ({ executePersona, getExecution }));

describe('ApiPlayground result provenance', () => {
  it('waits for the queued local run to land, then labels it without claiming an HTTP response', async () => {
    // `execute_persona` returns the row as queued; the output arrives on the
    // re-read once the run lands.
    executePersona.mockResolvedValueOnce({
      id: 'exec-1', status: 'queued', output_data: null, error_message: null,
      duration_ms: null, cost_usd: null, model_used: null,
    });
    getExecution.mockResolvedValue({
      id: 'exec-1', status: 'completed', output_data: 'hello from the run', error_message: null,
      duration_ms: 5, cost_usd: null, model_used: null,
    });
    render(<ApiPlayground slug="demo" personaId="persona-1" endpointUrl="https://cloud.example/api/deployed/demo" />);

    fireEvent.click(screen.getByRole('button', { name: 'API Playground' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send Request' }));

    expect(await screen.findByText('Local run completed', undefined, { timeout: 3000 })).toBeTruthy();
    expect(screen.getByText('hello from the run')).toBeTruthy();
    expect(screen.queryByText('200 OK')).toBeNull();
    expect(executePersona).toHaveBeenCalledWith('persona-1', undefined, expect.any(String));
    expect(getExecution).toHaveBeenCalledWith('exec-1', 'persona-1');
    fireEvent.click(screen.getByRole('button', { name: 'Snippets' }));
    expect(screen.getByText('Code snippets call the deployed endpoint. Playground results come from a local run.')).toBeTruthy();
  });
});
