import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const leaf = (prefix: string) => new Proxy({}, { get: (_o, k) => `${prefix}.${String(k)}` });
const t = new Proxy({}, {
  get: (_o, section) => new Proxy({}, { get: (_s, sub) => leaf(`${String(section)}.${String(sub)}`) }),
});
const common = new Proxy({}, { get: (_o, k) => `common.${String(k)}` });
const tRoot = new Proxy({}, { get: (_o, section) => (section === 'common' ? common : Reflect.get(t, section)) });
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: tRoot,
    tx: (s: string, vars: Record<string, unknown>) => `${s}|${JSON.stringify(vars)}`,
    language: 'en',
  }),
  getActiveTranslations: () => tRoot,
}));
vi.mock('../RowActionMenu', () => ({ RowActionMenu: () => null }));

import { ComfortableRow } from '../ComfortableRow';
import { CompactRow } from '../CompactRow';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';

const review: PersonaDesignReview = {
  id: 'r1', test_case_id: 'r1', test_case_name: 'Inbox triage', instruction: '', status: 'passed',
  structural_score: null, semantic_score: null, connectors_used: '["gmail"]', trigger_types: '[]',
  design_result: null, structural_evaluation: null, semantic_evaluation: null, test_run_id: 'seed-1',
  had_references: null, suggested_adjustment: null, adjustment_generation: null,
  use_case_flows: JSON.stringify([{ id: 'f1' }, { id: 'f2' }]),
  reviewed_at: '2026-10-01T00:00:00Z', created_at: '2026-10-01T00:00:00Z', adoption_count: 2,
  last_adopted_at: null, category: null,
};

const noop = () => {};

describe('gallery row keyboard access', () => {
  it('the comfortable row takes focus and Enter / Space toggle expansion', () => {
    const onToggleExpand = vi.fn();
    render(
      <ComfortableRow
        review={review} isExpanded={false} searchQuery="" isAiResult={false}
        credentialServiceTypes={new Set(['gmail'])} connectorReadiness={new Map()} openModal={noop}
        onToggleExpand={onToggleExpand} onViewFlows={noop} onDeleteReview={noop} onAddCredential={noop}
        rebuildReviewId={null} rebuildPhase="idle" onResetRebuild={noop} previewReviewId={null}
        previewPhase="idle" onResetPreview={noop} isCompareSelected={false} compareDisabled={false}
        onToggleCompare={noop}
      />,
    );
    const row = screen.getByTestId('template-row-r1');
    expect(row.tabIndex).toBe(0);
    fireEvent.keyDown(row, { key: 'Enter' });
    fireEvent.keyDown(row, { key: ' ' });
    expect(onToggleExpand).toHaveBeenCalledTimes(2);
    // A key pressed on a control inside the row belongs to that control.
    fireEvent.keyDown(screen.getByTestId('compare-toggle-r1'), { key: 'Enter' });
    expect(onToggleExpand).toHaveBeenCalledTimes(2);
  });

  it('the compact row takes focus and Enter opens detail', () => {
    const openModal = vi.fn();
    render(
      <CompactRow review={review} searchQuery="" isAiResult={false} openModal={openModal}
        credentialServiceTypes={new Set(['gmail'])} />,
    );
    const row = screen.getByTestId('template-row-r1');
    expect(row.tabIndex).toBe(0);
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(openModal).toHaveBeenCalledWith({ type: 'detail', review });
  });
});
