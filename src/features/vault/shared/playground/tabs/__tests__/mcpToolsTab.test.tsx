import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

const invoke = vi.fn();
vi.mock('@/lib/tauriInvoke', () => ({
  invokeWithTimeout: (...a: unknown[]) => invoke(...a),
}));

import { McpToolsTab } from '../McpToolsTab';
import { buildToolArgs } from '../mcpToolArgs';

const SCHEMA = {
  type: 'object',
  properties: {
    query: { type: 'string' },
    limit: { type: 'integer' },
    exact: { type: 'boolean' },
    filter: { type: 'object' },
  },
};

describe('buildToolArgs', () => {
  it('keeps a string parameter a string whatever it looks like', () => {
    const args = buildToolArgs(SCHEMA, { query: '123', limit: '5', exact: 'true', filter: '{"a":1}' });
    expect(args).toEqual({ query: '123', limit: 5, exact: true, filter: { a: 1 } });
  });

  it('does not de-quote or nullify string input', () => {
    expect(buildToolArgs(SCHEMA, { query: 'null' }).query).toBe('null');
    expect(buildToolArgs(SCHEMA, { query: '"quoted"' }).query).toBe('"quoted"');
  });

  it('skips blank fields and keeps unparseable JSON as text', () => {
    expect(buildToolArgs(SCHEMA, { query: '  ', filter: '{oops' })).toEqual({ filter: '{oops' });
  });
});

type Deferred = { resolve: (v: unknown) => void; reject: (e: unknown) => void };

describe('McpToolsTab', () => {
  let pending: Deferred[] = [];
  const TOOLS = [
    { name: 'tool_a', description: null, input_schema: { type: 'object', properties: {} } },
    { name: 'tool_b', description: null, input_schema: { type: 'object', properties: {} } },
    { name: 'tool_c', description: null, input_schema: { type: 'object', properties: { issue: { type: 'string' } } } },
  ];

  beforeEach(() => {
    pending = [];
    invoke.mockReset();
    invoke.mockImplementation((cmd: string) => {
      if (cmd === 'list_mcp_tools') return Promise.resolve(TOOLS);
      if (cmd === 'execute_mcp_tool') {
        return new Promise((resolve, reject) => pending.push({ resolve, reject }));
      }
      return Promise.resolve(null);
    });
  });

  async function discover() {
    render(<McpToolsTab credentialId="cred-1" />);
    fireEvent.click(screen.getAllByRole('button').find((b) => /discover/i.test(b.textContent ?? ''))!);
    await screen.findByTestId('mcp-tools-list');
  }

  const runButtons = () => screen.getAllByRole('button').filter((b) => b.textContent === 'Run');

  it('shows the backend reason, not [object Object], when a run is refused', async () => {
    await discover();
    fireEvent.click(runButtons()[0]!);
    fireEvent.click(screen.getAllByRole('button').find((b) => /execute/i.test(b.textContent ?? ''))!);
    await act(async () => { pending[0]!.reject({ error: 'MCP server exited before answering', kind: 'Internal' }); });
    await waitFor(() => expect(screen.getByText(/MCP server exited before answering/)).toBeTruthy());
    expect(screen.queryByText(/\[object Object\]/)).toBeNull();
  });

  it("does not paint a superseded run's result under the next tool", async () => {
    await discover();
    fireEvent.click(runButtons()[0]!);
    fireEvent.click(screen.getAllByRole('button').find((b) => /execute/i.test(b.textContent ?? ''))!);
    fireEvent.click(runButtons()[1]!);
    await act(async () => {
      pending[0]!.resolve({ content: [{ type: 'text', text: 'RESULT-OF-A' }], is_error: false, duration_ms: 3 });
    });
    expect(screen.queryByText('RESULT-OF-A')).toBeNull();
  });

  it('sends a string parameter typed as digits as a string', async () => {
    await discover();
    fireEvent.click(runButtons()[2]!);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '123' } });
    fireEvent.click(screen.getAllByRole('button').find((b) => /execute/i.test(b.textContent ?? ''))!);
    const call = invoke.mock.calls.find(([cmd]) => cmd === 'execute_mcp_tool')!;
    expect(JSON.stringify(call[1])).toContain('"issue":"123"');
  });
});
