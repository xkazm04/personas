/**
 * The one-time plaintext token must not outlive its reveal on the clipboard:
 * closing the dialog clears the clipboard, but only while it still holds what
 * this dialog copied (never someone else's later copy).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/api/agents/mcpTools', () => ({
  probeMcpServer: vi.fn(() => Promise.resolve({ live: true, port: 9555 })),
}));

import { CreatedKeyDialog } from './CreatedKeyDialog';
import type { CreateApiKeyResponse } from '@/api/auth/externalApiKeys';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

const response = { plaintext_token: 'pk_secret_123' } as CreateApiKeyResponse;

let clipboard = '';
const writeText = vi.fn(async (v: string) => {
  clipboard = v;
});
const readText = vi.fn(async () => clipboard);

beforeEach(() => {
  clipboard = '';
  writeText.mockClear();
  readText.mockClear();
  Object.defineProperty(navigator, 'clipboard', { value: { writeText, readText }, configurable: true });
});

function ackAndDone() {
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
}

describe('CreatedKeyDialog clipboard hygiene', () => {
  it('clears the clipboard on close when it still holds the copied key', async () => {
    const onClose = vi.fn();
    render(<CreatedKeyDialog response={response} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(clipboard).toBe('pk_secret_123'));
    ackAndDone();
    await waitFor(() => expect(clipboard).toBe(''));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('clears a copied MCP config (which embeds the token) on close', async () => {
    render(<CreatedKeyDialog response={response} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Copy MCP config/i }));
    await waitFor(() => expect(clipboard).toContain('pk_secret_123'));
    ackAndDone();
    await waitFor(() => expect(clipboard).toBe(''));
  });

  it('leaves the clipboard alone when the user copied something else since', async () => {
    render(<CreatedKeyDialog response={response} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(clipboard).toBe('pk_secret_123'));
    clipboard = 'something else';
    ackAndDone();
    await waitFor(() => expect(readText).toHaveBeenCalled());
    expect(clipboard).toBe('something else');
  });

  it('never touches the clipboard when nothing was copied', () => {
    render(<CreatedKeyDialog response={response} onClose={vi.fn()} />);
    ackAndDone();
    expect(readText).not.toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
  });
});
