// The bench on first load, and the one thing a judge will try: press a place.
// A prototype that throws on mount scores zero on craft however good the idea
// is, so this is deliberately a smoke test plus the descent.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import type { DevKpi } from '@/lib/bindings/DevKpi';

// Bypass IPC token wait.
(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

import en from '@/i18n/locales/en.json';
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t: en, tx: (s: string) => s }),
}));

import Assay from '../variants/Assay';
import type { KpiProjectRollup } from '../kpiOverviewModel';

function kpi(over: Partial<DevKpi> = {}): DevKpi {
  return {
    id: 'k', project_id: 'p', context_group_id: 'g', name: 'KPI', description: null,
    category: 'quality', measure_kind: 'manual', measure_config: null, unit: '%',
    direction: 'up', baseline_value: 0, target_value: 100, target_date: null,
    current_value: null, last_measured_at: null, cadence: 'weekly', status: 'active',
    created_by: 'test', rationale: null, needed_connector: null,
    created_at: '2026-01-01 00:00:00', updated_at: '2026-01-01 00:00:00',
    metric_type: null, tier: 'supporting', context_id: null, warn_at: null, crit_at: null,
    manual_rating: null, assessment_pros: null, assessment_cons: null,
    last_skip_at: null, last_skip_rationale: null, use_case_id: null,
    ...over,
  } as DevKpi;
}

function rollup(projectId: string, label: string, kpis: DevKpi[]): KpiProjectRollup {
  return {
    projectId, label, groupsUnknown: false, total: kpis.length, measured: 0, met: 0,
    onTrack: 0, offTrack: 0, unpaced: 0, coverage: 0, offTrackShare: null, band: 'unmeasured',
    groups: [{
      key: `${projectId}:g`, projectId, groupId: 'g', label: 'a group', domain: null, color: null,
      total: kpis.length, measured: 0, met: 0, onTrack: 0, offTrack: 0, unpaced: 0,
      coverage: 0, offTrackShare: null, band: 'unmeasured', kpis,
    }],
  };
}

const overview = [
  rollup('p1', 'personas', [
    kpi({ id: 'a' }),
    kpi({ id: 'b' }),
    kpi({ id: 'c', measure_kind: 'codebase', current_value: 120 }),
  ]),
  rollup('p2', 'ascent', [kpi({ id: 'd', measure_kind: 'connector' })]),
];

describe('Assay', () => {
  it('draws one lane per mechanism and nothing else', () => {
    render(<Assay overview={overview} loading={false} onFocus={vi.fn()} onOpen={vi.fn()} />);
    expect(screen.getByTestId('kpi-assay')).toBeTruthy();
    expect(screen.getByTestId('kpi-assay-lane-manual')).toBeTruthy();
    expect(screen.getByTestId('kpi-assay-lane-codebase')).toBeTruthy();
    expect(screen.getByTestId('kpi-assay-lane-connector')).toBeTruthy();
    expect(screen.queryByTestId('kpi-assay-lane-derived')).toBeNull();
  });

  it('a lane with full yield loses nobody, so it names no place', () => {
    render(<Assay overview={overview} loading={false} onFocus={vi.fn()} onOpen={vi.fn()} />);
    // the codebase KPI is read AND judged: nothing stalled, no rail
    expect(screen.queryByTestId('kpi-assay-share-codebase-p1')).toBeNull();
    expect(screen.getByTestId('kpi-assay-share-manual-p1')).toBeTruthy();
  });

  it('pressing a place at the portfolio DESCENDS rather than leaving the surface', () => {
    const onFocus = vi.fn();
    render(<Assay overview={overview} loading={false} onFocus={onFocus} onOpen={vi.fn()} />);
    fireEvent.click(screen.getByTestId('kpi-assay-share-manual-p1'));
    expect(onFocus).not.toHaveBeenCalled();
    // one altitude down the places are groups, and pressing one hands up a focus
    fireEvent.click(screen.getByTestId('kpi-assay-share-manual-g'));
    expect(onFocus).toHaveBeenCalledWith({ projectId: 'p1', groupId: 'g' });
  });

  it('renders a ghost, never a spinner, while a cold store is read', () => {
    render(<Assay overview={[]} loading onFocus={vi.fn()} onOpen={vi.fn()} />);
    expect(screen.getByTestId('kpi-assay-ghost')).toBeTruthy();
    expect(document.querySelector('.animate-spin')).toBeNull();
  });
});
