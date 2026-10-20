import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const leaf = (prefix: string) => new Proxy({}, { get: (_o, k) => `${prefix}.${String(k)}` });
const t = new Proxy({}, {
  get: (_o, section) => new Proxy({}, { get: (_s, sub) => leaf(`${String(section)}.${String(sub)}`) }),
});
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t, tx: (s: unknown) => String(s), language: 'en' }),
  getActiveTranslations: () => t,
}));

const galleryState = {
  allItems: [] as unknown[],
  total: 2,
  unfilteredTotal: 2,
  isLoading: false,
  isFetchingMore: false,
  hasMore: false,
  search: '',
  connectorFilter: [] as string[],
  categoryFilter: [] as string[],
  coverageFilter: 'all',
  sortBy: 'recent',
  sortDir: 'desc',
  aiSearchActive: false,
  aiSearchMode: false,
  aiSearchLoading: false,
  aiCliLog: [] as string[],
  trendingTemplates: [] as unknown[],
  recommendedTemplates: [] as unknown[],
  availableConnectors: [],
  availableCategories: [],
  setSearch: vi.fn(),
  setSortBy: vi.fn(),
  setSortDir: vi.fn(),
  setConnectorFilter: vi.fn(),
  setCategoryFilter: vi.fn(),
  setCoverageFilter: vi.fn(),
  setAiSearchMode: vi.fn(),
  clearAiSearch: vi.fn(),
  triggerAiSearch: vi.fn(),
  fetchMore: vi.fn(),
  refresh: vi.fn(),
};

vi.mock('@/hooks/design/template/useTemplateGallery', () => ({
  useTemplateGallery: () => galleryState,
}));
// Stable across renders, like the real hook's memoized values and callbacks.
const galleryActions = {
  displayItems: [],
  connectorReadiness: {},
  credentialServiceTypes: new Set<string>(),
  coverageCounts: { all: 0, ready: 0, partial: 0 },
  availableComponents: [],
  handleDeleteReview: vi.fn(),
  handleAddCredential: vi.fn(),
  handleCredentialSave: vi.fn(),
  clearCredentialModal: vi.fn(),
  credentialModalTarget: null,
};
vi.mock('../useGalleryActions', () => ({ useGalleryActions: () => galleryActions }));
vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (sel: (s: unknown) => unknown) =>
    sel({ templateAdoptActive: false, adoptionDraft: null, setAdoptionDraft: vi.fn() }),
}));
// Like the real hooks: a fresh object each render around stable callbacks.
const resetRebuild = vi.fn();
const resetPreview = vi.fn();
vi.mock('@/hooks/design/core/useBackgroundRebuild', () => ({
  useBackgroundRebuild: () => ({ reviewId: null, phase: 'idle', isActive: false, resetRebuild }),
}));
vi.mock('@/hooks/design/core/useBackgroundPreview', () => ({
  useBackgroundPreview: () => ({ reviewId: null, phase: 'idle', isActive: false, reviewName: null, resetPreview }),
}));

// Heavy children stubbed: this test is about which SHELVES mount.
vi.mock('../../search/TemplateSearchBar', () => ({ TemplateSearchBar: () => null }));
const listProps: Array<Record<string, unknown>> = [];
vi.mock('../TemplateVirtualList', () => ({
  TemplateVirtualList: (p: Record<string, unknown>) => { listProps.push(p); return null; },
}));
vi.mock('../../modals/TemplateModals', () => ({ TemplateModals: () => null }));
vi.mock('../../modals/TemplateDetailModal', () => ({ TemplateDetailModal: () => null }));
vi.mock('../../modals/CompareModal', () => ({ CompareModal: () => null }));
vi.mock('../CompareTray', () => ({ CompareTray: () => null }));
vi.mock('../../explore/BackgroundBanners', () => ({ BackgroundBanners: () => null }));
vi.mock('../../explore/TrendingCarousel', () => ({
  TrendingCarousel: () => <div data-testid="trending-shelf" />,
}));

import GeneratedReviewsTab from '../GeneratedReviewsTab';

const review = (id: string, name: string) => ({
  id,
  test_case_name: name,
  instruction: 'do a thing',
  connectors_used: '[]',
  adoption_count: 0,
  category: null,
  trigger_types: '[]',
});

function renderTab() {
  render(<GeneratedReviewsTab onViewFlows={vi.fn()} />);
}

describe('gallery explore shelves', () => {
  it('mounts the recommended shelf beside trending when browsing', () => {
    galleryState.trendingTemplates = [review('a', 'Trending A')];
    galleryState.recommendedTemplates = [review('b', 'Recommended B')];
    galleryState.search = '';
    renderTab();
    expect(screen.getByTestId('trending-shelf')).toBeTruthy();
    expect(screen.getByText('Recommended B')).toBeTruthy();
  });

  it('hides the recommended shelf once a filter is active', () => {
    galleryState.trendingTemplates = [review('a', 'Trending A')];
    galleryState.recommendedTemplates = [review('b', 'Recommended B')];
    galleryState.search = 'slack';
    renderTab();
    expect(screen.queryByText('Recommended B')).toBeNull();
  });

  it('renders nothing extra when there is nothing to recommend', () => {
    galleryState.trendingTemplates = [review('a', 'Trending A')];
    galleryState.recommendedTemplates = [];
    galleryState.search = '';
    renderTab();
    expect(screen.getByTestId('trending-shelf')).toBeTruthy();
    expect(screen.queryByText('Recommended B')).toBeNull();
  });

  it('hands the memoized rows the same callbacks on a re-render', () => {
    galleryState.trendingTemplates = [];
    galleryState.recommendedTemplates = [];
    galleryState.search = '';
    listProps.length = 0;
    const onViewFlows = vi.fn();
    const { rerender } = render(<GeneratedReviewsTab onViewFlows={onViewFlows} />);
    rerender(<GeneratedReviewsTab onViewFlows={onViewFlows} />);
    expect(listProps.length).toBeGreaterThanOrEqual(2);
    const [first, last] = [listProps[0]!, listProps[listProps.length - 1]!];
    const modalsOpen = (p: Record<string, unknown>) => (p.modals as { open: unknown }).open;
    expect(last.onResetRebuild).toBe(first.onResetRebuild);
    expect(last.onResetPreview).toBe(first.onResetPreview);
    expect(last.onToggleExpand).toBe(first.onToggleExpand);
    expect(modalsOpen(last)).toBe(modalsOpen(first));
  });
});
