import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { DistanceGroup } from '../kpiDistance';

// Bypass IPC token wait.
(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

import en from '@/i18n/locales/en.json';
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t: en, tx: (s: string) => s }),
}));

// The bars are a Recharts surface; this test is about the per-project
// autonomy slot, not the chart.
vi.mock('../kpiDistance', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  DistanceBars: () => null,
}));

import { KpiSignalBoard } from '../KpiSignalBoard';

const group = (key: string, label: string): DistanceGroup => ({ key, label, order: 0, rows: [] });

const groups = [group('p1', 'Personas'), group('p2', 'Web')];

describe('KpiSignalBoard per-project autopilot slot', () => {
  it('renders one control per project card on the All view', () => {
    const setMode = vi.fn();
    render(
      <KpiSignalBoard
        projectGroups={groups}
        onOpen={vi.fn()}
        renderAutopilot={(pid) => (
          <button type="button" data-testid={`ap-${pid}`} onClick={() => setMode(pid)}>
            mode
          </button>
        )}
      />,
    );

    // N of N cards carry the control, each bound to its own project id.
    expect(screen.getByTestId('kpi-signal-autopilot-p1')).toBeTruthy();
    expect(screen.getByTestId('kpi-signal-autopilot-p2')).toBeTruthy();

    fireEvent.click(screen.getByTestId('ap-p2'));
    expect(setMode).toHaveBeenCalledWith('p2');
  });

  it('renders no control when the host omits the slot (single-project view)', () => {
    render(<KpiSignalBoard projectGroups={groups} onOpen={vi.fn()} />);

    expect(screen.queryByTestId('kpi-signal-autopilot-p1')).toBeNull();
    expect(screen.queryByTestId('kpi-signal-autopilot-p2')).toBeNull();
  });
});
