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

import { UnsavedChangesBanner, SaveFailedBanner } from '../EditorBanners';

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

describe('Save & Switch busy state', () => {
  const renderBanner = (saving: boolean) => render(
    <UnsavedChangesBanner
      visible
      changedSections={['Settings']}
      onSaveAndSwitch={() => {}}
      onDiscardAndSwitch={() => {}}
      onDismiss={() => {}}
      saving={saving}
    />,
  );

  it('disables both actions while the save runs, so it never looks idle', () => {
    renderBanner(true);
    expect(screen.getByRole('button', { name: /save_and_switch/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /discard/ })).toBeDisabled();
  });

  it('leaves both actions enabled when no save is running', () => {
    renderBanner(false);
    expect(screen.getByRole('button', { name: /save_and_switch/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /discard/ })).toBeEnabled();
  });
});

describe('SaveFailedBanner', () => {
  it('renders its message and action with no dismiss control', () => {
    render(<SaveFailedBanner message="Could not save" actions={[<button key="r">Retry</button>]} />);
    expect(screen.getByText('Could not save')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'common.dismiss' })).toBeNull();
  });
});
