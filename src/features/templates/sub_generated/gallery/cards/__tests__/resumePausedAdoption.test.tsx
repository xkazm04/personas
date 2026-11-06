import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

// DW-250. Resume searched only the gallery's loaded rows, which are paged and
// filtered. The real tab, banners, modal stack, system store and toast store are
// mounted; the review lookup is stubbed at its API seam, and the wizard is reduced
// to a dialog naming the review it opened on.

import en from '@/i18n/locales/en.json';
vi.mock('@/i18n/useTranslation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/useTranslation')>()),
  useTranslation: () => ({
    t: en,
    tx: (tpl: string, vars: Record<string, string>) =>
      Object.entries(vars).reduce((s, [k, v]) => s.replace(`{${k}}`, v), tpl),
    language: 'en',
  }),
}));

const getDesignReview = vi.hoisted(() => vi.fn<(id: string) => Promise<unknown>>());
vi.mock('@/api/overview/reviews', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/overview/reviews')>()),
  getDesignReview,
}));

const galleryState = vi.hoisted(() => ({
  allItems: [] as unknown[],
  total: 1,
  unfilteredTotal: 1,
  isLoading: false,
  isFetchingMore: false,
  hasMore: true,
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
  setSearch: () => {},
  setSortBy: () => {},
  setSortDir: () => {},
  setConnectorFilter: () => {},
  setCategoryFilter: () => {},
  setCoverageFilter: () => {},
  setAiSearchMode: () => {},
  clearAiSearch: () => {},
  triggerAiSearch: () => {},
  fetchMore: () => {},
  refresh: () => {},
}));
vi.mock('@/hooks/design/template/useTemplateGallery', () => ({
  useTemplateGallery: () => galleryState,
}));
vi.mock('../useGalleryActions', () => ({
  useGalleryActions: () => ({
    displayItems: [],
    connectorReadiness: {},
    credentialServiceTypes: new Set<string>(),
    coverageCounts: { all: 0, ready: 0, partial: 0 },
    availableComponents: [],
    credentialModalTarget: null,
  }),
}));
vi.mock('@/hooks/design/core/useBackgroundRebuild', () => ({
  useBackgroundRebuild: () => ({ reviewId: null, phase: 'idle', isActive: false, resetRebuild: () => {} }),
}));
vi.mock('@/hooks/design/core/useBackgroundPreview', () => ({
  useBackgroundPreview: () => ({ reviewId: null, phase: 'idle', isActive: false, reviewName: null, resetPreview: () => {} }),
}));

vi.mock('../../search/TemplateSearchBar', () => ({ TemplateSearchBar: () => null }));
vi.mock('../TemplateVirtualList', () => ({ TemplateVirtualList: () => null }));
vi.mock('../../modals/TemplateDetailModal', () => ({ TemplateDetailModal: () => null }));
vi.mock('../../modals/CompareModal', () => ({ CompareModal: () => null }));
vi.mock('../CompareTray', () => ({ CompareTray: () => null }));
vi.mock('../../../shared/TeamSynthesisPanel', () => ({ TeamSynthesisPanel: () => null }));
vi.mock('../../modals/TemplateModals', () => ({
  TemplateModals: ({
    modals,
  }: {
    modals: {
      isOpen: (type: string) => boolean;
      find: (type: string) => { review: { test_case_name: string } } | undefined;
    };
  }): ReactNode =>
    modals.isOpen('adopt') ? (
      <div role="dialog" aria-label="adoption">
        {modals.find('adopt')?.review.test_case_name}
      </div>
    ) : null,
}));

import { useSystemStore } from '@/stores/systemStore';
import { useToastStore } from '@/stores/toastStore';
import GeneratedReviewsTab from '../GeneratedReviewsTab';

const NAME = 'Morning Digest';
const REVIEW = {
  id: 'review-250',
  test_case_name: NAME,
  instruction: 'do a thing',
  connectors_used: '[]',
  adoption_count: 0,
  category: null,
  trigger_types: '[]',
};
const DRAFT = {
  reviewId: REVIEW.id,
  templateName: NAME,
  step: 'connect',
  connectorSwaps: {},
  connectorCredentialMap: {},
  variableValues: {},
  savedAt: 1,
  userAnswers: { q1: 'alpha' },
};

// IPC rejections are serialized AppError objects, never an `Error`.
const TRANSIENT = { error: 'IPC call timed out', kind: 'internal' };
const GONE = { error: `Design review ${REVIEW.id} not found`, kind: 'not_found' };

const draftBanner = () => screen.queryByRole('button', { name: new RegExp(NAME) });
const adoptionBanner = () =>
  screen.getByRole('button', { name: new RegExp(en.templates.banners.adoption_in_progress) });
const adoptionDialog = () => screen.queryByRole('dialog', { name: 'adoption' });

const warningOrError = () =>
  useToastStore
    .getState()
    .toasts.filter((x) => x.kind === 'standard' && (x.type === 'warning' || x.type === 'error'));

function renderDraft() {
  useSystemStore.setState({ adoptionDraft: DRAFT, templateAdoptActive: false } as never);
  render(<GeneratedReviewsTab onViewFlows={() => {}} />);
}

function renderActiveAdoption() {
  useSystemStore.setState({
    adoptionDraft: null,
    templateAdoptActive: true,
    activeAdoptionReviewId: REVIEW.id,
  } as never);
  render(<GeneratedReviewsTab onViewFlows={() => {}} />);
}

beforeEach(() => {
  galleryState.allItems = [];
  getDesignReview.mockReset().mockResolvedValue(REVIEW);
  useToastStore.setState({ toasts: [] } as never);
});

afterEach(() => {
  cleanup();
  useSystemStore.setState({
    adoptionDraft: null,
    templateAdoptActive: false,
    activeAdoptionReviewId: null,
  } as never);
});

describe('resuming a saved draft', () => {
  it('opens on the looked-up review when the template is not loaded, and keeps the draft', async () => {
    renderDraft();
    fireEvent.click(draftBanner()!);

    expect(await screen.findByRole('dialog', { name: 'adoption' })).toHaveTextContent(NAME);
    expect(getDesignReview).toHaveBeenCalledWith(REVIEW.id);
    expect(useSystemStore.getState().adoptionDraft).toEqual(DRAFT);
    expect(warningOrError()).toHaveLength(0);
  });

  it('opens from the loaded rows without a lookup', async () => {
    galleryState.allItems = [REVIEW];
    renderDraft();
    fireEvent.click(draftBanner()!);

    expect(await screen.findByRole('dialog', { name: 'adoption' })).toHaveTextContent(NAME);
    expect(getDesignReview).not.toHaveBeenCalled();
  });

  it('explains a failed lookup and keeps the draft resumable', async () => {
    getDesignReview.mockRejectedValueOnce(TRANSIENT);
    renderDraft();
    fireEvent.click(draftBanner()!);

    await waitFor(() => expect(warningOrError()).toHaveLength(1));
    expect(warningOrError()[0]!.message).toContain(NAME);
    expect(useSystemStore.getState().adoptionDraft).toEqual(DRAFT);
    expect(adoptionDialog()).not.toBeInTheDocument();

    // The transient failure passed: the same banner gets the person back in.
    fireEvent.click(draftBanner()!);
    expect(await screen.findByRole('dialog', { name: 'adoption' })).toHaveTextContent(NAME);
  });

  it('explains a template the backend says is gone', async () => {
    getDesignReview.mockRejectedValueOnce(GONE);
    renderDraft();
    fireEvent.click(draftBanner()!);

    await waitFor(() => expect(warningOrError()).toHaveLength(1));
    expect(warningOrError()[0]!.message).toContain(NAME);
    expect(adoptionDialog()).not.toBeInTheDocument();
  });

  it('explains a lookup that finds nothing', async () => {
    getDesignReview.mockResolvedValueOnce(null);
    renderDraft();
    fireEvent.click(draftBanner()!);

    await waitFor(() => expect(warningOrError()).toHaveLength(1));
    expect(warningOrError()[0]!.message).toContain(NAME);
    expect(adoptionDialog()).not.toBeInTheDocument();
  });
});

describe('resuming an adoption in progress', () => {
  it('opens on the looked-up review when the template is not loaded', async () => {
    renderActiveAdoption();
    fireEvent.click(adoptionBanner());

    expect(await screen.findByRole('dialog', { name: 'adoption' })).toHaveTextContent(NAME);
    expect(getDesignReview).toHaveBeenCalledWith(REVIEW.id);
    expect(warningOrError()).toHaveLength(0);
  });

  it('opens from the loaded rows without a lookup', async () => {
    galleryState.allItems = [REVIEW];
    renderActiveAdoption();
    fireEvent.click(adoptionBanner());

    expect(await screen.findByRole('dialog', { name: 'adoption' })).toHaveTextContent(NAME);
    expect(getDesignReview).not.toHaveBeenCalled();
  });

  it.each([
    ['fails', () => getDesignReview.mockRejectedValueOnce(TRANSIENT)],
    ['says the template is gone', () => getDesignReview.mockRejectedValueOnce(GONE)],
    ['finds nothing', () => getDesignReview.mockResolvedValueOnce(null)],
  ])('shows a message when the lookup %s', async (_case, arrange) => {
    arrange();
    renderActiveAdoption();
    fireEvent.click(adoptionBanner());

    await waitFor(() => expect(warningOrError()).toHaveLength(1));
    expect(adoptionDialog()).not.toBeInTheDocument();
  });
});
