import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: {
      plugins: {
        dev_tools: { lifecycle_readiness: 'Lifecycle Readiness —' },
        dev_lifecycle: {
          readiness_ready: 'Ready to go',
          readiness_partial: 'Partially configured',
          readiness_not_configured: 'Not configured',
          readiness_step_counter_label: 'Steps',
          readiness_step_counter_value: '{passed}/{total}',
        },
      },
    },
    tx: (template: string, vars: Record<string, string | number>) => {
      return template.replace(/\{(\w+)\}/g, (_, key) => String(vars[key] ?? `{${key}}`));
    },
  }),
}));

import { ReadinessGates, type QualityGate } from '../ReadinessGates';

const GATES: QualityGate[] = [
  { id: 'github', label: 'GitHub repo', ok: true,  weight: 30 },
  { id: 'persona', label: 'Dev Clone',  ok: true,  weight: 25 },
  { id: 'schedule', label: 'Hourly scan', ok: false, weight: 15 },
  { id: 'approved', label: 'Approval listener', ok: false, weight: 15 },
  { id: 'rejected', label: 'Rejection listener', ok: false, weight: 15 },
];

describe('ReadinessGates step-stones', () => {
  it('shows the weighted quality score in the header', () => {
    render(<ReadinessGates gates={GATES} qualityScore={55} />);
    expect(screen.getByText(/55\/100/)).toBeInTheDocument();
  });

  it('renders the N/total step counter', () => {
    render(<ReadinessGates gates={GATES} qualityScore={55} />);
    // 2 passed / 5 total in the fixture
    expect(screen.getByText('2/5')).toBeInTheDocument();
  });

  it('renders one labelled step per gate in source order', () => {
    render(<ReadinessGates gates={GATES} qualityScore={55} />);
    expect(screen.getByText('GitHub repo')).toBeInTheDocument();
    expect(screen.getByText('Dev Clone')).toBeInTheDocument();
    expect(screen.getByText('Hourly scan')).toBeInTheDocument();
    expect(screen.getByText('Approval listener')).toBeInTheDocument();
    expect(screen.getByText('Rejection listener')).toBeInTheDocument();
  });

  it('shows the partial-readiness message for mid-range scores', () => {
    render(<ReadinessGates gates={GATES} qualityScore={55} />);
    expect(screen.getByText('Partially configured')).toBeInTheDocument();
  });

  it('shows the ready message at the high threshold', () => {
    const allOk = GATES.map((g) => ({ ...g, ok: true }));
    render(<ReadinessGates gates={allOk} qualityScore={100} />);
    expect(screen.getByText('Ready to go')).toBeInTheDocument();
    expect(screen.getByText('5/5')).toBeInTheDocument();
  });

  it('shows the not-configured message at the low threshold', () => {
    const noneOk = GATES.map((g) => ({ ...g, ok: false }));
    render(<ReadinessGates gates={noneOk} qualityScore={0} />);
    expect(screen.getByText('Not configured')).toBeInTheDocument();
    expect(screen.getByText('0/5')).toBeInTheDocument();
  });

  it('renders weight badges for each gate', () => {
    render(<ReadinessGates gates={GATES} qualityScore={55} />);
    expect(screen.getByText('+30')).toBeInTheDocument();
    expect(screen.getByText('+25')).toBeInTheDocument();
    // Three +15 entries
    expect(screen.getAllByText('+15')).toHaveLength(3);
  });
});
