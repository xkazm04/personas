import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t: { common: { enabled: 'Enabled', disabled: 'Disabled' } }, tx: (s: string) => s }),
}));

import { SettingRow } from '../SettingRow';

describe('SettingRow', () => {
  it('describes its switch with the row description, so a screen reader hears what the toggle does', () => {
    render(
      <SettingRow label="Capture clipboard" description="Copies are saved for 24 hours" checked={false} onChange={() => {}} />,
    );
    const toggle = screen.getByRole('switch', { name: 'Capture clipboard' });
    const ids = (toggle.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
    expect(ids.map((id) => document.getElementById(id)?.textContent)).toEqual(['Copies are saved for 24 hours']);
  });

  it('leaves the switch undescribed when there is no description', () => {
    render(<SettingRow label="Capture clipboard" checked onChange={() => {}} />);
    expect(screen.getByRole('switch').hasAttribute('aria-describedby')).toBe(false);
  });
});
