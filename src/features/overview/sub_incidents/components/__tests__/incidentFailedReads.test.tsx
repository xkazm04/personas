import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { preloadSectionsAsync } from '@/i18n/useTranslation';
import { en } from '@/i18n/en';
import { IncidentsInboxKpiHeader } from '../IncidentsInboxKpiHeader';
import { AutonomousLogPanel } from '../autonomous/AutonomousLogPanel';
import { OPEN_ONLY_FILTERS } from '../../libs/incidentFilterDefaults';

describe('incident surfaces never paint a failed read as zero', () => {
  beforeAll(async () => {
    await preloadSectionsAsync('en', ['overview']);
  });

  it('KPI tiles show "not measured" when the summary read failed', () => {
    render(
      <IncidentsInboxKpiHeader
        summary={null}
        pending={false}
        filters={OPEN_ONLY_FILTERS}
        onApplyFilters={vi.fn()}
        autonomous={{ count: null, active: false, onToggle: vi.fn() }}
      />,
    );
    const figures = screen.getAllByRole('button').map((b) => b.textContent ?? '');
    expect(figures).toHaveLength(5);
    for (const text of figures) {
      expect(text).toContain('—');
      expect(text).not.toMatch(/\d/);
    }
  });

  it('KPI tiles still show a measured zero', () => {
    render(
      <IncidentsInboxKpiHeader
        summary={{ open: 0, acknowledged: 0, resolved: 0, openBySeverity: [] } as never}
        pending={false}
        filters={OPEN_ONLY_FILTERS}
        onApplyFilters={vi.fn()}
      />,
    );
    const figures = screen.getAllByRole('button').map((b) => b.textContent ?? '');
    for (const text of figures) expect(text).toContain('0');
  });

  it('the autonomous log shows the failure, not an inbox-zero, when its read failed', () => {
    render(
      <AutonomousLogPanel incidents={[]} loading={false} failed onRetry={vi.fn()} onOpenIncident={vi.fn()} onBack={vi.fn()} />,
    );
    expect(screen.getByText(en.overview.incidents.load_failed)).toBeTruthy();
    expect(screen.queryByText(en.overview.incidents.noc_handled_empty)).toBeNull();
  });
});
