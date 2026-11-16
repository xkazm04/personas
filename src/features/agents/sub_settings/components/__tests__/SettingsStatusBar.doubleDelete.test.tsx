// action-busy-states: the persona delete confirm must disarm synchronously - one press, one delete.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const leaf = (prefix: string) => new Proxy({}, { get: (_o, k) => `${prefix}.${String(k)}` });
const t = new Proxy({}, {
  get: (_o, section) => section === 'agents'
    ? new Proxy({}, { get: (_s, sub) => leaf(String(sub)) })
    : leaf(String(section)),
});
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t, tx: (s: unknown) => String(s), language: 'en' }),
  getActiveTranslations: () => t,
}));

import { SettingsStatusBar } from '../SettingsStatusBar';

const base = {
  isSaving: false, isDirty: false, changedSections: [] as string[],
  showDeleteConfirm: false, setShowDeleteConfirm: () => undefined, onDelete: async () => undefined,
};

describe('SettingsStatusBar', () => {
  it('calls onDelete once on a fast double press of Confirm', () => {
    const onDelete = vi.fn(() => new Promise<void>(() => undefined));
    render(<SettingsStatusBar {...base} showDeleteConfirm onDelete={onDelete} />);
    const confirm = screen.getByTestId('agent-delete-confirm');
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});
