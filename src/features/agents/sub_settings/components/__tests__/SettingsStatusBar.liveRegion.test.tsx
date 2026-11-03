// The save state (saving / changed / all saved) must reach assistive tech, not only the eye.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

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
  it('announces the save state through a polite live region', () => {
    const { rerender } = render(<SettingsStatusBar {...base} isDirty changedSections={['Settings']} />);
    rerender(<SettingsStatusBar {...base} />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('settings_status.all_saved');
  });
});
