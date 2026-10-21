import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const getAppSettingsBulk = vi.fn();
vi.mock('@/api/system/settings', () => ({
  getAppSetting: vi.fn(),
  getAppSettingsBulk: (...a: unknown[]) => getAppSettingsBulk(...a),
  setAppSetting: vi.fn(),
  deleteAppSetting: vi.fn(),
}));
vi.mock('@/api/system/qwen', () => ({
  getQwenStatus: vi.fn(async () => ({ configured: false })),
  setQwenCredentials: vi.fn(),
  clearQwenCredentials: vi.fn(),
}));

import { ByomApiKeyManager } from '../components/ByomApiKeyManager';

describe('BYOM key load failure', () => {
  beforeEach(() => getAppSettingsBulk.mockReset());

  it('shows a retry instead of empty placeholder rows when the bulk read fails, and recovers', async () => {
    getAppSettingsBulk.mockRejectedValueOnce(new Error('ipc down'));
    getAppSettingsBulk.mockResolvedValueOnce({ ollama_api_key: 'sk-abc', litellm_base_url: null, litellm_master_key: null });
    render(<ByomApiKeyManager />);
    const retry = await screen.findByRole('button', { name: /retry/i });
    fireEvent.click(retry);
    await waitFor(() => expect(getAppSettingsBulk).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('button', { name: /retry/i })).toBeNull());
  });
});
