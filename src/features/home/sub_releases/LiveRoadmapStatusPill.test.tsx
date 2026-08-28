import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Plain matchers, not jest-dom's: `tsconfig.json` excludes `src/**/__tests__/**`
// but NOT a co-located `*.test.tsx`, so this file IS typechecked and the
// jest-dom matcher types (loaded only through the vitest setup file) are not
// visible to `tsc --noEmit`.

import { en } from '@/i18n/en';
import { LiveRoadmapStatusPill } from './LiveRoadmapStatusPill';
import type { ReleasesTranslation } from './i18n/useReleasesTranslation';

/**
 * Only the `live.*` branch is read by the pill; the rest of the shape is
 * irrelevant to it. Asserting the invariant behind the cast: the component
 * touches `t.live` and nothing else, which the render below would fail on if
 * that ever stopped being true.
 */
const t = {
  live: {
    updatedPrefix: 'Updated',
    sourceCache: 'From cache',
    sourceStale: 'Offline snapshot',
    sourceFallback: 'Bundled',
  },
} as unknown as ReleasesTranslation;

/** Tailwind sizing classes that satisfy WCAG 2.2 SC 2.5.8 (24x24 CSS px). */
const MIN_TARGET = ['h-6', 'w-6'];

describe('LiveRoadmapStatusPill refresh target', () => {
  it('gives the refresh control a >=24x24 pointer target', () => {
    render(
      <LiveRoadmapStatusPill
        status="fresh"
        fetchedAt={new Date().toISOString()}
        refreshing={false}
        onRefresh={vi.fn()}
        t={t}
        language="en"
      />,
    );
    const button = screen.getByRole('button', { name: en.common.refresh });
    // `px-2 py-0.5` around a 12px icon measured ~26x16 — under the 24px floor
    // on the short axis, on the only control this surface has.
    for (const cls of MIN_TARGET) {
      expect(button.className.split(/\s+/)).toContain(cls);
    }
    expect(button.className).not.toContain('py-0.5');
  });

  it('offers no refresh control on the bundled-snapshot branch', () => {
    render(
      <LiveRoadmapStatusPill
        status="unavailable"
        fetchedAt={null}
        refreshing={false}
        onRefresh={vi.fn()}
        t={t}
        language="en"
      />,
    );
    expect(screen.queryByRole('button')).toBeNull();
  });
});
