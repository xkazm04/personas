import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';

const leaf = (prefix: string) => new Proxy({}, { get: (_o, k) => `${prefix}.${String(k)}` });
const t = new Proxy({}, {
  get: (_o, section) => section === 'templates'
    ? new Proxy({}, { get: (_s, sub) => leaf(String(sub)) })
    : leaf(String(section)),
});
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t, tx: (s: unknown) => String(s), language: 'en' }),
  getActiveTranslations: () => t,
}));

import { TemplateVirtualList } from '../TemplateVirtualList';
import { useModalStack } from '../../modals/useModalStack';
import type { TemplateModal } from '../reviewParseCache';

type ListProps = ComponentProps<typeof TemplateVirtualList>;
type Overrides = Partial<Omit<ListProps, 'modals'>>;

const CLEAR = /empty\.clear_search/;

function Harness(props: Omit<ListProps, 'modals'>) {
  const modals = useModalStack<TemplateModal>();
  return <TemplateVirtualList {...props} modals={modals} />;
}

function baseProps(overrides: Overrides = {}): Omit<ListProps, 'modals'> {
  return {
    displayItems: [],
    density: 'compact',
    expandedRow: null,
    searchQuery: 'zzzzzz',
    isAiResult: false,
    credentialServiceTypes: new Set<string>(),
    connectorReadiness: new Map(),
    onToggleExpand: vi.fn(),
    onViewFlows: vi.fn(),
    onDeleteReview: vi.fn(async () => {}),
    onAddCredential: vi.fn(),
    rebuildReviewId: null,
    rebuildPhase: 'idle',
    onResetRebuild: vi.fn(),
    previewReviewId: null,
    previewPhase: 'idle',
    onResetPreview: vi.fn(),
    isFetchingMore: false,
    hasMore: false,
    isLoading: false,
    fetchMore: vi.fn(),
    compareSelectedIds: new Set<string>(),
    compareAtCapacity: false,
    onToggleCompare: vi.fn(),
    onClearSearch: vi.fn(),
    onAiSearch: vi.fn(),
    revealResetKey: 'k',
    ...overrides,
  };
}

describe('TemplateVirtualList paging behind client-side facets', () => {
  // u086 card "Client facets say 'no results' about catalog pages never
  // fetched": a facet that empties the loaded pages left fetchMore unreachable
  // (no virtual row -> lastVisibleIndex -1) and painted the settled empty state.
  it('keeps paging when the filtered list is empty and more pages exist', () => {
    const fetchMore = vi.fn();
    render(<Harness {...baseProps({ hasMore: true, fetchMore })} />);
    expect(fetchMore).toHaveBeenCalledTimes(1);
  });

  it('does not claim "no results" while unfetched pages remain', () => {
    render(<Harness {...baseProps({ hasMore: true, isFetchingMore: true })} />);
    expect(screen.queryByRole('button', { name: CLEAR })).toBeNull();
  });

  it('settles on the empty state once the whole catalog is loaded', () => {
    const fetchMore = vi.fn();
    render(<Harness {...baseProps({ hasMore: false, fetchMore })} />);
    expect(fetchMore).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: CLEAR })).toBeTruthy();
  });

  it('does not page while the first page is still loading or a page is in flight', () => {
    const fetchMore = vi.fn();
    const { rerender } = render(<Harness {...baseProps({ hasMore: true, isLoading: true, fetchMore })} />);
    rerender(<Harness {...baseProps({ hasMore: true, isFetchingMore: true, fetchMore })} />);
    expect(fetchMore).not.toHaveBeenCalled();
  });

  it('does not retry a failed page in a loop when the in-flight flag settles', () => {
    const fetchMore = vi.fn();
    const { rerender } = render(<Harness {...baseProps({ hasMore: true, isFetchingMore: true, fetchMore })} />);
    rerender(<Harness {...baseProps({ hasMore: true, isFetchingMore: false, pagingFailed: true, fetchMore })} />);
    expect(fetchMore).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: CLEAR })).toBeTruthy();
  });
});
