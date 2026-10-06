// The console on first load, and the dial. The concept IS the keyboard, so
// the keys are the thing worth a test: a prototype whose arrow keys do not
// move the cursor has not built the idea.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import type { DevKpi } from '@/lib/bindings/DevKpi';

// Bypass IPC token wait.
(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

import en from '@/i18n/locales/en.json';
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t: en, tx: (s: string) => s }),
}));

import Console from '../variants/Console';
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
    kpi({ id: 'a', name: 'first kpi' }),
    kpi({ id: 'b', name: 'second kpi' }),
  ]),
  rollup('p2', 'ascent', [kpi({ id: 'c', name: 'third kpi' })]),
];

const press = (key: string) => fireEvent.keyDown(window, { key });

describe('Console', () => {
  it('opens on the first KPI of the ranking, whole', () => {
    render(<Console overview={overview} loading={false} onFocus={vi.fn()} onOpen={vi.fn()} />);
    expect(screen.getByTestId('kpi-console-plate')).toBeTruthy();
    expect(screen.getByText('first kpi')).toBeTruthy();
    expect(screen.queryByText('second kpi')).toBeNull();
  });

  it('draws one tick per KPI in the whole estate, nothing capped', () => {
    render(<Console overview={overview} loading={false} onFocus={vi.fn()} onOpen={vi.fn()} />);
    expect(screen.getByTestId('kpi-console-spine').querySelectorAll('[data-tick]')).toHaveLength(3);
  });

  it('the arrow keys walk the sequence and clamp at both ends', () => {
    render(<Console overview={overview} loading={false} onFocus={vi.fn()} onOpen={vi.fn()} />);
    press('ArrowRight');
    expect(screen.getByText('second kpi')).toBeTruthy();
    press('ArrowLeft');
    press('ArrowLeft');
    expect(screen.getByText('first kpi')).toBeTruthy();
    press('End');
    expect(screen.getByText('third kpi')).toBeTruthy();
    press('ArrowRight');
    expect(screen.getByText('third kpi')).toBeTruthy();
  });

  it('[ and ] jump by project rather than stepping', () => {
    render(<Console overview={overview} loading={false} onFocus={vi.fn()} onOpen={vi.fn()} />);
    press(']');
    expect(screen.getByText('third kpi')).toBeTruthy();
    press('[');
    expect(screen.getByText('first kpi')).toBeTruthy();
  });

  it('Enter opens the KPI and g hands up the group focus, both for the one under the cursor', () => {
    const onOpen = vi.fn();
    const onFocus = vi.fn();
    render(<Console overview={overview} loading={false} onFocus={onFocus} onOpen={onOpen} />);
    press('ArrowRight');
    press('Enter');
    expect(onOpen).toHaveBeenCalledWith('b');
    press('g');
    expect(onFocus).toHaveBeenCalledWith({ projectId: 'p1', groupId: 'g' });
  });

  it('never claims an ordinary character key out of a text field', () => {
    const onFocus = vi.fn();
    render(
      <>
        <input data-testid="field" />
        <Console overview={overview} loading={false} onFocus={onFocus} onOpen={vi.fn()} />
      </>,
    );
    fireEvent.keyDown(screen.getByTestId('field'), { key: 'g', bubbles: true });
    expect(onFocus).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByTestId('field'), { key: ']', bubbles: true });
    expect(screen.getByText('first kpi')).toBeTruthy();
  });

  it('a click on a tick moves the cursor to it', () => {
    render(<Console overview={overview} loading={false} onFocus={vi.fn()} onOpen={vi.fn()} />);
    const ticks = screen.getByTestId('kpi-console-spine').querySelectorAll('[data-tick]');
    fireEvent.click(ticks[2]!);
    expect(screen.getByText('third kpi')).toBeTruthy();
  });

  it('prints the keys rather than hiding them behind a hover', () => {
    render(<Console overview={overview} loading={false} onFocus={vi.fn()} onOpen={vi.fn()} />);
    expect(screen.getByText(/PgUp/)).toBeTruthy();
  });

  it('renders a ghost, never a spinner, while a cold store is read', () => {
    render(<Console overview={[]} loading onFocus={vi.fn()} onOpen={vi.fn()} />);
    expect(screen.getByTestId('kpi-console-ghost')).toBeTruthy();
    expect(document.querySelectorAll('[class*=spin]').length).toBe(0);
  });

  it('an empty estate renders the surface and no plate, rather than throwing', () => {
    render(<Console overview={[]} loading={false} onFocus={vi.fn()} onOpen={vi.fn()} />);
    expect(screen.getByTestId('kpi-console')).toBeTruthy();
    expect(screen.queryByTestId('kpi-console-plate')).toBeNull();
    press('ArrowRight');
    expect(screen.getByTestId('kpi-console')).toBeTruthy();
  });
});
