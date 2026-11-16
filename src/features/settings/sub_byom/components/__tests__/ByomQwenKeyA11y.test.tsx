/**
 * DW-55 - the stored Qwen key's replace control must be reachable without a
 * mouse. The masked display that opens the editor is a click-only div: no
 * role, no tab stop, no key handler, no name. These cases pin the contract:
 * a named button, described by the provider label, that opens the editor on
 * Enter or Space and moves focus into the key input.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import en from '@/i18n/locales/en.json';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

const qwen = vi.hoisted(() => ({
  getQwenStatus: vi.fn(),
  setQwenCredentials: vi.fn(),
  clearQwenCredentials: vi.fn(),
}));

vi.mock('@/api/system/qwen', () => qwen);
const settings = vi.hoisted(() => ({ getAppSettingsBulk: vi.fn() }));

vi.mock('@/api/system/settings', () => ({
  getAppSetting: vi.fn().mockResolvedValue(null),
  getAppSettingsBulk: settings.getAppSettingsBulk,
  setAppSetting: vi.fn().mockResolvedValue(undefined),
  deleteAppSetting: vi.fn().mockResolvedValue(undefined),
}));

import { ByomApiKeyManager } from '../ByomApiKeyManager';

const EDIT = en.common.edit;
const QWEN = en.settings.byom.provider_qwen_label;

function qwenRow(): HTMLElement {
  return screen.getByText(QWEN).closest('.rounded-card') as HTMLElement;
}

async function renderStored() {
  render(<ByomApiKeyManager />);
  // The stored badge proves getQwenStatus resolved configured.
  await waitFor(() => expect(qwenRow()).toHaveTextContent(en.settings.byom.stored));
  expect(qwenRow().querySelector('input')).toBeNull();
}

// Scoped to the Qwen row: the settings-key rows above may grow their own
// Edit buttons, which must not make this lookup ambiguous.
function editButton(): HTMLElement {
  return within(qwenRow()).getByRole('button', { name: EDIT, description: new RegExp(QWEN) });
}

describe('Qwen stored key replace control (DW-55)', () => {
  beforeEach(() => {
    qwen.getQwenStatus.mockReset().mockResolvedValue({ configured: true });
    qwen.setQwenCredentials.mockReset();
    qwen.clearQwenCredentials.mockReset();
    settings.getAppSettingsBulk.mockReset().mockResolvedValue({});
  });

  it('is a button named by common.edit and described by the Qwen label', async () => {
    await renderStored();
    const btn = within(qwenRow()).getByRole('button', { name: EDIT });
    expect(btn).toHaveAccessibleDescription(expect.stringContaining(QWEN));
  });

  it.each([
    ['Enter', '{Enter}'],
    ['Space', ' '],
  ])('opens the editor on %s from the keyboard and focuses the key input', async (_k, key) => {
    const user = userEvent.setup();
    await renderStored();
    const btn = editButton();

    // Reachable by Tab, not only by programmatic focus.
    for (let i = 0; i < 30 && document.activeElement !== btn; i++) await user.tab();
    expect(document.activeElement).toBe(btn);

    await user.keyboard(key);

    const input = await waitFor(() => {
      const el = qwenRow().querySelector('input');
      expect(el).not.toBeNull();
      return el as HTMLInputElement;
    });
    expect(input.type).toBe('password');
    await waitFor(() => expect(document.activeElement).toBe(input));
  });
});
