import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

/**
 * An IPC rejection is a serialized AppError object, never an Error. The spec
 * parser's reason was dropped for a generic English line and a failed Send
 * printed the envelope's raw JSON.
 */
const invoke = vi.fn();
vi.mock('@/lib/tauriInvoke', () => ({
  invokeWithTimeout: (...a: unknown[]) => invoke(...a),
}));

import { ApiExplorerTab } from '../ApiExplorerTab';

const EP = { method: 'GET', path: '/me', summary: null, description: null, parameters: [], request_body: null, tags: [] } as never;

describe('ApiExplorerTab error slots', () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockImplementation((cmd: string) => {
      if (cmd === 'parse_api_definition') {
        return Promise.reject({ error: 'Unsupported OpenAPI version 1.2', kind: 'Validation' });
      }
      if (cmd === 'execute_api_request') {
        return Promise.reject({ error: 'Path escapes the connector base URL', kind: 'Validation' });
      }
      if (cmd === 'get_credential_recipes') return Promise.resolve([]);
      return Promise.resolve(null);
    });
  });

  const button = (re: RegExp) => screen.getAllByRole('button').find((b) => re.test(b.textContent ?? ''))!;

  it("names the parser's reason when a pasted spec is refused", async () => {
    render(<ApiExplorerTab credentialId="cred-1" catalogEndpoints={[EP]} />);
    fireEvent.click(button(/paste/i));
    fireEvent.change(screen.getAllByRole('textbox').at(-1)!, { target: { value: 'openapi: 1.2' } });
    fireEvent.click(button(/parse/i));
    await waitFor(() => expect(screen.getByText(/Unsupported OpenAPI version 1\.2/)).toBeTruthy());
  });

  it('shows a refused request as its reason, not the envelope JSON', async () => {
    render(<ApiExplorerTab credentialId="cred-1" catalogEndpoints={[EP]} />);
    fireEvent.click(button(/^try$/i));
    fireEvent.click(button(/^send$/i));
    await waitFor(() => expect(screen.getByText(/Path escapes the connector base URL/)).toBeTruthy());
    expect(screen.queryByText(/"kind"/)).toBeNull();
  });
});
