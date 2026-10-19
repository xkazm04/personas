/**
 * ByomApiKeyManager - the Qwen Cloud key row (keyring-backed).
 *
 * The load-bearing case: a refused keyring write must be visible on the row.
 * Before, the failure was only logged, so the editor stayed open with no
 * signal and nothing distinguished "refused" from "still saving".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

const qwen = vi.hoisted(() => ({
  getQwenStatus: vi.fn(),
  setQwenCredentials: vi.fn(),
  clearQwenCredentials: vi.fn(),
}));

vi.mock('@/api/system/qwen', () => qwen);
vi.mock('@/api/system/settings', () => ({
  getAppSetting: vi.fn().mockResolvedValue(null),
  getAppSettingsBulk: vi.fn().mockResolvedValue({}),
  setAppSetting: vi.fn().mockResolvedValue(undefined),
  deleteAppSetting: vi.fn().mockResolvedValue(undefined),
}));

import { ByomApiKeyManager } from '../ByomApiKeyManager';

function qwenRow(): HTMLElement {
  const label = screen.getByText('Qwen Cloud');
  return label.closest('.rounded-card') as HTMLElement;
}

describe('ByomApiKeyManager Qwen key row', () => {
  beforeEach(() => {
    qwen.getQwenStatus.mockReset().mockResolvedValue({ configured: false });
    qwen.setQwenCredentials.mockReset();
    qwen.clearQwenCredentials.mockReset();
  });

  it('shows an error badge when the keyring refuses the key', async () => {
    // invokeWithTimeout rejects with a serialized AppError object, not an Error.
    qwen.setQwenCredentials.mockRejectedValue({ error: 'keyring unavailable', kind: 'Internal' });
    render(<ByomApiKeyManager />);
    await waitFor(() => expect(qwen.getQwenStatus).toHaveBeenCalled());

    const row = qwenRow();
    const input = row.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'sk-test-key' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(qwen.setQwenCredentials).toHaveBeenCalledWith('sk-test-key'));
    await waitFor(() => expect(row).toHaveTextContent('Error'));
    // The secret never reaches the rendered row.
    expect(row.textContent).not.toContain('keyring unavailable');
  });

  it('shows no error badge after a successful save', async () => {
    qwen.setQwenCredentials.mockResolvedValue(undefined);
    render(<ByomApiKeyManager />);
    await waitFor(() => expect(qwen.getQwenStatus).toHaveBeenCalled());

    const row = qwenRow();
    const input = row.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'sk-test-key' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(row).toHaveTextContent('Stored'));
    expect(row).not.toHaveTextContent('Error');
  });
});
