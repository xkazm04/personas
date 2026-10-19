import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { ConnectorDefinition } from '@/lib/types/types';
import type { CliSpecInfo } from '@/api/auth/cliCapture';

const cliCheckInstalled = vi.fn();
vi.mock('@/api/auth/cliCapture', () => ({
  cliCheckInstalled: (...a: unknown[]) => cliCheckInstalled(...a),
  cliVerifyAuth: vi.fn(),
  cliCaptureSave: vi.fn(),
}));

import { CliConnectionPanel } from '../CliConnectionPanel';

const connector = { name: 'github', label: 'GitHub' } as Pick<ConnectorDefinition, 'name' | 'label'>;
const spec: CliSpecInfo = {
  service_type: 'github',
  binary: 'gh',
  display_label: 'GitHub CLI',
  install_hint: 'winget install GitHub.cli',
  auth_instruction: 'Run gh auth login',
  docs_url: 'https://cli.github.com',
};

function Host({ initialName = '' }: { initialName?: string }) {
  const [name, setName] = useState(initialName);
  return (
    <CliConnectionPanel
      connector={connector as ConnectorDefinition}
      spec={spec}
      credentialName={name}
      onCredentialNameChange={setName}
      onSaved={vi.fn()}
      onCancel={vi.fn()}
    />
  );
}

describe('CliConnectionPanel', () => {
  beforeEach(() => {
    cliCheckInstalled.mockReset();
    cliCheckInstalled.mockResolvedValue({ service_type: 'github', installed: true, binary_path: '/usr/bin/gh', version: 'gh 2.0' });
  });

  it('defaults the name once, then lets the user clear the field', async () => {
    render(<Host />);
    await act(async () => {});
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.value).toBe('GitHub CLI');

    fireEvent.change(input, { target: { value: '' } });
    await act(async () => {});
    // The default used to re-fill on every empty render, so the field could
    // never be cleared to type a different name.
    expect(input.value).toBe('');
  });

  it('replaces a name that is just the connector label with the CLI default', async () => {
    render(<Host initialName="GitHub" />);
    await act(async () => {});
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('GitHub CLI');
  });

  it('classifies an IPC rejection by its message, not "[object Object]"', async () => {
    // invokeWithTimeout rejects with a serialized AppError object, never an Error.
    cliCheckInstalled.mockRejectedValue({ error: 'Probe timed out after 5s', kind: 'Internal' });
    render(<Host />);
    await act(async () => {});
    // The generic fallback is what an unclassifiable "[object Object]" resolves to.
    expect(screen.queryByText('Something went wrong.')).toBeNull();
    expect(document.body.textContent).not.toContain('[object Object]');
    expect(screen.getByText('The request took too long to complete.')).toBeTruthy();
  });
});
