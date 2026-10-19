// A section chunk landing used to re-render EVERY useTranslation() consumer,
// whether or not anything had read that section. Right after first paint the
// idle background load lands ~40 English chunks nobody has read yet, so the
// whole translated tree re-rendered once per chunk. A landing now re-renders
// only when some read resolved that section to a fallback.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';

// Keep the module's idle background load from landing sections behind the
// test's back: each case decides exactly which chunks arrive and when.
vi.mock('@/lib/idlePrefetch', () => ({ idlePrefetch: () => {} }));

import { preloadSectionsAsync, useTranslation } from '../useTranslation';
import { useI18nStore } from '@/stores/i18nStore';
import en from '../locales/en.json';

function Probe({ onRender, read }: { onRender: () => void; read?: (t: Record<string, unknown>) => unknown }) {
  const { t } = useTranslation();
  onRender();
  const value = read ? read(t as unknown as Record<string, unknown>) : null;
  return <span data-testid="v">{typeof value === 'string' ? value : ''}</span>;
}

describe('section-load broadcast', () => {
  afterEach(() => {
    useI18nStore.setState({ language: 'en' });
  });

  it('does not re-render a consumer for chunks it never read', async () => {
    useI18nStore.setState({ language: 'en' });
    const onRender = vi.fn();
    render(<Probe onRender={onRender} read={(t) => (t.common as Record<string, unknown>).save} />);
    const before = onRender.mock.calls.length;

    await act(async () => {
      await preloadSectionsAsync('en', ['council', 'features', 'matrix_v3', 'sharing', 'research_lab']);
    });

    expect(onRender.mock.calls.length).toBe(before);
  });

  it('re-renders a consumer that read the section before its chunk landed', async () => {
    useI18nStore.setState({ language: 'en' });
    const onRender = vi.fn();
    const { getByTestId } = render(
      <Probe onRender={onRender} read={(t) => (t.tiers as Record<string, unknown> | undefined)?.[Object.keys(en.tiers)[0]!]} />,
    );
    const firstKey = Object.keys(en.tiers)[0] as keyof typeof en.tiers;
    const expected = en.tiers[firstKey];
    expect(typeof expected).toBe('string');
    expect(getByTestId('v').textContent).toBe('');

    await act(async () => {
      await preloadSectionsAsync('en', ['tiers']);
    });

    expect(getByTestId('v').textContent).toBe(expected);
  });
});
