/**
 * One tool run must repaint one card. The pre-flight `JSON.parse` of a card's
 * input payload runs on every render of that card, so the number of parses of
 * an IDLE card's payload counts its re-renders without reaching into React.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import type { PersonaToolDefinition } from '@/lib/bindings/PersonaToolDefinition';

const invokeMock = vi.fn();
vi.mock('@/api/agents/tools', () => ({ invokeToolDirect: (...a: unknown[]) => invokeMock(...a) }));

import { ToolRunnerPanel } from '../ToolRunnerPanel';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

function tool(i: number): PersonaToolDefinition {
  return {
    id: `tool-${i}`,
    name: `tool_${i}`,
    category: 'api',
    description: '',
    script_path: '',
    input_schema: JSON.stringify({ properties: { [`field_${i}`]: {} } }),
    output_schema: null,
    requires_credential_type: null,
    implementation_guide: 'Curl: curl https://example.com',
    is_builtin: false,
    created_at: '',
    updated_at: '',
  } as PersonaToolDefinition;
}

describe('ToolRunnerPanel render scope', () => {
  afterEach(() => { vi.restoreAllMocks(); invokeMock.mockReset(); });

  it('does not re-parse the payload of idle cards when another tool runs', async () => {
    invokeMock.mockResolvedValue({ success: true, output: 'ok', duration_ms: 1 });
    const tools = [0, 1, 2, 3, 4].map(tool);
    render(<ToolRunnerPanel tools={tools} personaId="p1" />);
    fireEvent.click(screen.getByTestId('tool-card-toggle-tool_3'));

    const realParse = JSON.parse;
    const idleParses: string[] = [];
    vi.spyOn(JSON, 'parse').mockImplementation(((text: string, reviver?: never) => {
      if (typeof text === 'string' && /"field_[0-24]"/.test(text) && !text.includes('properties')) idleParses.push(text);
      return realParse(text, reviver);
    }) as typeof JSON.parse);

    fireEvent.click(screen.getByTestId('tool-run-tool_3'));
    await waitFor(() => expect(screen.getByTestId('tool-result-tool_3')).toBeInTheDocument());
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(idleParses).toHaveLength(0);
  });
});
