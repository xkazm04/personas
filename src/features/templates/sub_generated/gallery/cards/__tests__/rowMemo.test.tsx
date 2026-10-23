import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { useState, type ComponentProps } from 'react';

const leaf = (prefix: string) => new Proxy({}, { get: (_o, k) => `${prefix}.${String(k)}` });
const t = new Proxy({}, { get: (_o, section) => leaf(String(section)) });
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t, tx: (s: unknown) => String(s), language: 'en' }),
  getActiveTranslations: () => t,
}));

// jsdom has no layout: list every row so the memo boundary is what decides.
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count, getItemKey }: { count: number; getItemKey: (i: number) => string | number }) => ({
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ index, key: getItemKey(index), start: index * 72 })),
    getTotalSize: () => count * 72,
    measure: () => {},
    measureElement: () => {},
  }),
}));

// One render of a row = one render of its action menu.
const rowRenders = vi.fn();
vi.mock('../RowActionMenu', () => ({
  RowActionMenu: ({ reviewId }: { reviewId: string }) => { rowRenders(reviewId); return null; },
}));

import { TemplateVirtualList } from '../TemplateVirtualList';
import { useModalStack } from '../../modals/useModalStack';
import type { TemplateModal } from '../reviewParseCache';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';

const review = (id: string): PersonaDesignReview => ({
  id, test_case_id: id, test_case_name: `Template ${id}`, instruction: '', status: 'passed',
  structural_score: null, semantic_score: null, connectors_used: '[]', trigger_types: '[]',
  design_result: null, structural_evaluation: null, semantic_evaluation: null, test_run_id: 'seed-1',
  had_references: null, suggested_adjustment: null, adjustment_generation: null, use_case_flows: null,
  reviewed_at: '2026-10-01T00:00:00Z', created_at: '2026-10-01T00:00:00Z', adoption_count: 0,
  last_adopted_at: null, category: null,
});

const ITEMS = [review('a'), review('b'), review('c')];
const stable = {
  credentialServiceTypes: new Set<string>(),
  connectorReadiness: new Map(),
  compareSelectedIds: new Set<string>(),
  noop: () => {},
  noopAsync: async () => {},
};

type ListProps = ComponentProps<typeof TemplateVirtualList>;

/** Re-renders like GeneratedReviewsTab: a fresh modal-stack object each time. */
function Gallery() {
  const [tick, setTick] = useState(0);
  const modals = useModalStack<TemplateModal>();
  const props: ListProps = {
    displayItems: ITEMS, density: 'comfortable', expandedRow: null, searchQuery: '', isAiResult: false,
    credentialServiceTypes: stable.credentialServiceTypes, connectorReadiness: stable.connectorReadiness,
    modals, onToggleExpand: stable.noop, onViewFlows: stable.noop, onDeleteReview: stable.noopAsync,
    onAddCredential: stable.noop, rebuildReviewId: null, rebuildPhase: 'idle', onResetRebuild: stable.noop,
    previewReviewId: null, previewPhase: 'idle', onResetPreview: stable.noop, isFetchingMore: false,
    hasMore: false, isLoading: false, fetchMore: stable.noop, compareSelectedIds: stable.compareSelectedIds,
    compareAtCapacity: false, onToggleCompare: stable.noop, revealResetKey: 'k',
  };
  return (
    <>
      <button type="button" onClick={() => setTick(tick + 1)}>rerender</button>
      <TemplateVirtualList {...props} />
    </>
  );
}

describe('gallery row memo', () => {
  it('an unrelated gallery re-render does not re-render the rows', () => {
    render(<Gallery />);
    expect(rowRenders).toHaveBeenCalledTimes(ITEMS.length);
    rowRenders.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'rerender' }));
    expect(rowRenders).toHaveBeenCalledTimes(0);
  });
});
