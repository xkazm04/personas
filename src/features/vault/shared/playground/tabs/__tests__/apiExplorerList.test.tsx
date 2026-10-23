import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const invoke = vi.fn();
vi.mock('@/lib/tauriInvoke', () => ({
  invokeWithTimeout: (...a: unknown[]) => invoke(...a),
}));

import { ApiExplorerTab } from '../ApiExplorerTab';

const ep = (path: string, description: string) =>
  ({ method: 'GET', path, summary: null, description, parameters: [], request_body: null, tags: [] }) as never;

describe('ApiExplorerTab endpoint list', () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockImplementation((cmd: string) =>
      Promise.resolve(cmd === 'get_credential_recipes' ? [] : null));
  });

  it('keeps the opened endpoint open, and only it, while the filter changes', async () => {
    render(<ApiExplorerTab credentialId="cred-1" catalogEndpoints={[ep('/alpha', 'ALPHA-DETAIL'), ep('/beta', 'BETA-DETAIL')]} />);
    fireEvent.click(screen.getByText('/alpha'));
    expect(screen.getByText('ALPHA-DETAIL')).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'beta' } });
    expect(screen.queryByText('BETA-DETAIL')).toBeNull();
  });

  it('does not claim there are no endpoints before the saved spec has loaded', async () => {
    let settle: (v: unknown) => void = () => {};
    invoke.mockImplementation((cmd: string) => cmd === 'load_api_definition'
      ? new Promise((r) => { settle = r; })
      : Promise.resolve(cmd === 'get_credential_recipes' ? [] : null));
    render(<ApiExplorerTab credentialId="cred-1" />);
    expect(screen.queryByText('No endpoints')).toBeNull();
    settle(null);
    await waitFor(() => expect(screen.getByText('No endpoints')).toBeTruthy());
  });
});
