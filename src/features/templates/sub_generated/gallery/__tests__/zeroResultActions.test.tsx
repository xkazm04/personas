import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

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

import { TemplateVirtualList } from '../cards/TemplateVirtualList';

const CLEAR = /empty\.clear_search/;
const TRY_AI = /search\.try_ai_search/;

function renderList(overrides: Record<string, unknown> = {}) {
  const onClearSearch = vi.fn();
  const onAiSearch = vi.fn();
  const props = {
    displayItems: [],
    density: 'compact',
    expandedRow: null,
    searchQuery: 'zzzzzz',
    isAiResult: false,
    credentialServiceTypes: new Set<string>(),
    connectorReadiness: {},
    modals: { open: vi.fn(), close: vi.fn(), isOpen: () => false, current: null },
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
    onClearSearch,
    onAiSearch,
    revealResetKey: 'k',
    ...overrides,
  };
  const List = TemplateVirtualList as unknown as (p: Record<string, unknown>) => JSX.Element;
  render(<List {...props} />);
  return { onClearSearch, onAiSearch };
}

describe('zero-result gallery search', () => {
  it('offers Clear and Try AI when a settled search matched nothing', () => {
    renderList();
    expect(screen.getByRole('button', { name: CLEAR })).toBeTruthy();
    expect(screen.getByRole('button', { name: TRY_AI })).toBeTruthy();
  });

  it('clears the query and hands it to AI search', () => {
    const { onClearSearch, onAiSearch } = renderList();
    fireEvent.click(screen.getByRole('button', { name: TRY_AI }));
    expect(onAiSearch).toHaveBeenCalledWith('zzzzzz');
    fireEvent.click(screen.getByRole('button', { name: CLEAR }));
    expect(onClearSearch).toHaveBeenCalled();
  });

  it('offers no CTAs when the catalog is empty with no query', () => {
    renderList({ searchQuery: '' });
    expect(screen.queryByRole('button', { name: CLEAR })).toBeNull();
    expect(screen.queryByRole('button', { name: TRY_AI })).toBeNull();
  });

  it('does not re-offer AI search on an AI result that came back empty', () => {
    renderList({ isAiResult: true });
    expect(screen.getByRole('button', { name: CLEAR })).toBeTruthy();
    expect(screen.queryByRole('button', { name: TRY_AI })).toBeNull();
  });

  it('shows ghost rows instead of the empty state while the fetch is in flight', () => {
    renderList({ isLoading: true });
    expect(screen.queryByRole('button', { name: CLEAR })).toBeNull();
  });
});
