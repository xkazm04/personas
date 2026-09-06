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

import { UnsavedChangesBanner } from '../EditorBanners';

describe('editor banners', () => {
  it('names the icon-only dismiss control for assistive tech', () => {
    const onDismiss = vi.fn();
    render(
      <UnsavedChangesBanner
        visible
        changedSections={['Settings']}
        onSaveAndSwitch={() => {}}
        onDiscardAndSwitch={() => {}}
        onDismiss={onDismiss}
      />,
    );
    // The X glyph is the only content; without an accessible name a screen
    // reader announced "button" and nothing else.
    fireEvent.click(screen.getByRole('button', { name: 'common.dismiss' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
