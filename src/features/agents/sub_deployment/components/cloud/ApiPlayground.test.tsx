import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ApiPlayground } from './ApiPlayground';

const executePersona = vi.hoisted(() => vi.fn());
vi.mock('@/api/agents/executions', () => ({ executePersona }));

describe('ApiPlayground result provenance', () => {
  it('labels a successful local execution without claiming an HTTP response', async () => {
    executePersona.mockResolvedValueOnce({
      status: 'completed', output_data: 'hello', error_message: null,
      duration_ms: 5, cost_usd: null, model_used: null,
    });
    render(<ApiPlayground slug="demo" personaId="persona-1" endpointUrl="https://cloud.example/api/deployed/demo" />);

    fireEvent.click(screen.getByRole('button', { name: 'API Playground' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send Request' }));

    expect(await screen.findByText('Local run completed')).toBeInTheDocument();
    expect(screen.queryByText('200 OK')).not.toBeInTheDocument();
    expect(executePersona).toHaveBeenCalledWith('persona-1', undefined, expect.any(String));
    fireEvent.click(screen.getByRole('button', { name: 'Snippets' }));
    expect(screen.getByText('Code snippets call the deployed endpoint. Playground results come from a local run.')).toBeInTheDocument();
  });
});
