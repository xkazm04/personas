import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import type { TemplatePerformance } from '@/lib/bindings/TemplatePerformance';

import en from '@/i18n/locales/en.json';
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t: en, tx: (s: string) => s, language: 'en' }),
}));

let perf: TemplatePerformance;
vi.mock('@/hooks/design/template/useTemplatePerformance', () => ({
  useTemplatePerformance: () => ({ performance: perf, loading: false, error: null }),
}));

import { OverviewTab } from '../OverviewTab';

const review = { id: 'r1', structural_score: null, adjustment_generation: null } as unknown as PersonaDesignReview;

function basePerf(over: Partial<TemplatePerformance>): TemplatePerformance {
  return {
    review_id: 'r1', total_adoptions: 2, total_executions: 0, success_rate: 0, avg_cost_usd: 0,
    positive_count: 0, negative_count: 0, top_positive_labels: [], top_negative_labels: [],
    derived_quality_score: 0, data_available: true, ...over,
  };
}

function tileValue(label: string): string {
  const tile = screen.getByText(label).closest('div')!.parentElement!;
  return tile.lastElementChild?.textContent ?? '';
}

describe('template Overview performance tiles', () => {
  beforeEach(() => { perf = basePerf({}); });

  it('reads "not measured" for a template no agent has run yet, not 0% success', () => {
    render(<OverviewTab designResult={null} flows={[]} adjustment={null} review={review} onViewFlows={vi.fn()} />);
    expect(tileValue(en.templates.overview_tab.success_label)).toBe('—');
    expect(tileValue(en.templates.overview_tab.avg_cost_label)).toBe('—');
  });

  it('shows the measured rate once runs exist', () => {
    perf = basePerf({ total_executions: 4, success_rate: 0.75, avg_cost_usd: 0.02 });
    render(<OverviewTab designResult={null} flows={[]} adjustment={null} review={review} onViewFlows={vi.fn()} />);
    expect(tileValue(en.templates.overview_tab.success_label)).toBe('75%');
    expect(tileValue(en.templates.overview_tab.avg_cost_label)).not.toBe('—');
  });
});
