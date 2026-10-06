// The almanac on first load, and the descent. A prototype that throws on
// mount scores zero on craft however good the idea is.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import type { DevKpi } from '@/lib/bindings/DevKpi';

// Bypass IPC token wait.
(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

import en from '@/i18n/locales/en.json';
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t: en, tx: (s: string) => s }),
}));

import Almanac from '../variants/Almanac';
import type { KpiProjectRollup } from '../kpiOverviewModel';

const DAY = 86_400_000;

function iso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

function kpi(over: Partial<DevKpi> = {}): DevKpi {
  return {
    id: 'k', project_id: 'p', context_group_id: 'g', name: 'KPI', description: null,
    category: 'quality', measure_kind: 'manual', measure_config: null, unit: '%',
    direction: 'up', baseline_value: 0, target_value: 100, target_date: null,
    current_value: null, last_measured_at: null, cadence: 'weekly', status: 'active',
    created_by: 'test', rationale: null, needed_connector: null,
    created_at: iso(Date.now() - 100 * DAY), updated_at: iso(Date.now() - 100 * DAY),
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
  rollup('p1', 'personas', [kpi({ id: 'a' }), kpi({ id: 'b', cadence: 'manual' })]),
  rollup('p2', 'ascent', [kpi({ id: 'c', cadence: 'manual' })]),
];

describe('Almanac', () => {
  it('draws one band per place and nothing else', () => {
    render(<Almanac overview={overview} loading={false} onFocus={vi.fn()} onOpen={vi.fn()} />);
    expect(screen.getByTestId('kpi-almanac')).toBeTruthy();
    expect(screen.getByTestId('kpi-almanac-band-p1')).toBeTruthy();
    expect(screen.getByTestId('kpi-almanac-band-p2')).toBeTruthy();
    expect(screen.queryByTestId('kpi-almanac-band-p3')).toBeNull();
  });

  it('descends at the portfolio, then hands up a focus one level down', () => {
    const onFocus = vi.fn();
    render(<Almanac overview={overview} loading={false} onFocus={onFocus} onOpen={vi.fn()} />);
    fireEvent.click(screen.getByTestId('kpi-almanac-place-p1'));
    expect(onFocus).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('kpi-almanac-place-g'));
    expect(onFocus).toHaveBeenCalledWith({ projectId: 'p1', groupId: 'g' });
  });

  it('renders a ghost, never a spinner, while a cold store is read', () => {
    render(<Almanac overview={[]} loading onFocus={vi.fn()} onOpen={vi.fn()} />);
    expect(screen.getByTestId('kpi-almanac-ghost')).toBeTruthy();
    expect(document.querySelectorAll('[class*=spin]').length).toBe(0);
  });

  it('an estate with no rows still renders its axis rather than collapsing', () => {
    render(<Almanac overview={[]} loading={false} onFocus={vi.fn()} onOpen={vi.fn()} />);
    expect(screen.getByTestId('kpi-almanac')).toBeTruthy();
  });
});
