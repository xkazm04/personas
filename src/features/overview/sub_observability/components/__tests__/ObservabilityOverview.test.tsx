// The Overview strip's success rate: a window with no runs has no rate, so the tile
// reads "-" (StatStrip's honest null), never a measured-looking 0.0%.
import { render, screen, within } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import { preloadSectionsAsync } from '@/i18n/useTranslation';
import type { MetricsSummary } from '@/lib/bindings/MetricsSummary';
import { ObservabilityOverview, type OverviewProps } from '../ObservabilityOverview';
import { useObservabilityWords } from '../../libs/useObservabilityWords';

const summary = (total: number, ok: number, failed: number): MetricsSummary => ({
  totalExecutions: total, successfulExecutions: ok, failedExecutions: failed, totalCostUsd: 0, activePersonas: 0, periodDays: 7,
});

function Harness({ s }: { s: MetricsSummary }) {
  const w = useObservabilityWords();
  // Only the fields the Overview section reads; the cast names that invariant.
  const d: Partial<OverviewProps['d']> = {
    summary: s, observabilityError: null, personas: [], selectedPersonaId: null, setSelectedPersonaId: () => {},
    days: 7, setDays: () => {}, customDateRange: null, setCustomDateRange: () => {},
    autoRefresh: false, setAutoRefresh: () => {}, refreshAll: async () => [],
  };
  return <ObservabilityOverview d={d as OverviewProps['d']} w={w} pipelineErrors={{}} pipelineFetchedAt={{ observabilityMetrics: Date.now(), alertRules: Date.now(), alertHistory: Date.now(), healingIssues: Date.now() }} />;
}

const rateTile = () => {
  const label = screen.getAllByText('Success Rate').find((el) => el.classList.contains('typo-card-label'));
  return label!.parentElement!;
};

describe('ObservabilityOverview success rate', () => {
  beforeAll(async () => {
    await preloadSectionsAsync('en', ['overview', 'triggers']);
  });

  it('no runs in the window reads as no rate, not 0.0%', () => {
    render(<Harness s={summary(0, 0, 0)} />);
    expect(within(rateTile()).queryByText(/0\.0\s*%/)).toBeNull();
    expect(within(rateTile()).getByText('-')).toBeTruthy();
  });

  it('a window with runs still shows its rate', () => {
    render(<Harness s={summary(4, 3, 1)} />);
    expect(within(rateTile()).getByText(/75\.0\s*%/)).toBeTruthy();
  });

  it('queued and running runs stay out of the denominator', () => {
    render(<Harness s={summary(10, 3, 1)} />);
    expect(within(rateTile()).getByText(/75\.0\s*%/)).toBeTruthy();
  });

  it('a window of only in-flight runs has no rate yet', () => {
    render(<Harness s={summary(5, 0, 0)} />);
    expect(within(rateTile()).getByText('-')).toBeTruthy();
  });
});
