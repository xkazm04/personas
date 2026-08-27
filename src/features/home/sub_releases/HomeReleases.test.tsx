import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// Plain matchers, not jest-dom's: `tsconfig.json` excludes `src/**/__tests__/**`
// but NOT a co-located `*.test.tsx`, so this file IS typechecked and the
// jest-dom matcher types (loaded only through the vitest setup file) are not
// visible to `tsc --noEmit`.

import { en } from '@/i18n/en';
import type { Release } from '@/data/releases';

const navReleases = vi.fn<() => Release[]>();

vi.mock('@/data/releases', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/data/releases')>();
  return { ...actual, getNavReleases: () => navReleases() };
});

vi.mock('./useLiveRoadmap', () => ({
  useLiveRoadmap: () => ({
    roadmap: null,
    fetchedAt: null,
    status: 'unavailable' as const,
    refreshing: false,
    refresh: vi.fn(),
  }),
}));

vi.mock('@/hooks/sidebar/useWhatsNewIndicator', () => ({
  useWhatsNewIndicator: () => ({ show: false, dismiss: vi.fn() }),
}));

import HomeReleases from './HomeReleases';

function roadmapRelease(items: Release['items']): Release {
  return { version: 'roadmap', status: 'roadmap', items } as unknown as Release;
}

describe('HomeReleases roadmap resolution', () => {
  beforeEach(() => {
    navReleases.mockReset();
  });

  it('shows the empty state instead of a void when no roadmap item has content', () => {
    // Item ids that exist in releases.json but carry no `whats_new` key — the
    // shape that used to render `[roadmap.zz-nonexistent]` cards, and after
    // `keepDisplayable` would otherwise render nothing at all.
    navReleases.mockReturnValue([
      roadmapRelease([
        { id: 'zz-nonexistent-1', type: 'feature', status: 'planned', priority: 'now', sort_order: 1 },
      ] as unknown as Release['items']),
    ]);
    render(<HomeReleases />);
    expect(screen.getByText(en.releases.whats_new.empty)).not.toBeNull();
    expect(screen.queryByText(/\[roadmap\./)).toBeNull();
  });

  it('renders the hero instead of the empty state when the roadmap has content', () => {
    // '2' is a real bundled roadmap item id with translated content.
    navReleases.mockReturnValue([
      roadmapRelease([
        { id: '2', type: 'feature', status: 'in_progress', priority: 'now', sort_order: 1 },
      ] as unknown as Release['items']),
    ]);
    render(<HomeReleases />);
    expect(screen.queryByText(en.releases.whats_new.empty)).toBeNull();
    expect(screen.getByText(en.releases.whats_new.release_roadmap_item_2_title)).not.toBeNull();
  });
});
