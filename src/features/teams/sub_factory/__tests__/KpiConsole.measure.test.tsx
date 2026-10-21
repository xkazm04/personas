/**
 * KpiConsole: "Measure now" reported "Measured X saved" while the StatStrip,
 * sparkline and last-measured line kept the old reading until a full factory
 * reload. The console now shows the reading it just took.
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const evaluate = vi.hoisted(() => vi.fn());
vi.mock('@/api/devTools/kpis', () => ({ evaluateKpi: evaluate }));
vi.mock('../MeasureSetupModal', () => ({ MeasureSetupModal: () => null }));
vi.mock('../KpiSteer', () => ({ KpiSteer: () => null }));

import { KpiConsole } from '../KpiConsole';
import { useFactoryWords } from '../useFactoryWords';
import type { MockKpi } from '../factoryModel';

const KPI: MockKpi = {
  id: 'k1', name: 'Coverage', category: 'quality', tier: 'primary', measureKind: 'codebase',
  unit: '%', direction: 'up', baseline: 10, current: 10, target: 90, warnAt: 40, critAt: 5,
  cadence: 'weekly', manualRating: null, lastMeasuredAt: '3d ago', series: [10],
};

function Harness() {
  const w = useFactoryWords();
  return <KpiConsole kpi={KPI} w={w} onEdit={() => {}} />;
}

describe('KpiConsole measure now', () => {
  it('shows the measured value in the strip and last-measured line at once', async () => {
    evaluate.mockResolvedValue({ id: 'm1', kpi_id: 'k1', value: 77, measured_at: new Date().toISOString(), source: 'evaluator', env: 'production', evidence: null, note: null });
    render(<Harness />);
    expect(screen.getByText('3d ago')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /measure/i }));
    await waitFor(() => expect(screen.queryByText('3d ago')).toBeNull());
    expect(screen.getAllByText(/77/).length).toBeGreaterThan(0);
  });
});
