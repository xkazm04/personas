import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ObservabilityPlanWidget } from '../ObservabilityPlanWidget';

describe('ObservabilityPlanWidget', () => {
  it('renders empty state when both sections are missing', () => {
    render(<ObservabilityPlanWidget config={{}} />);
    expect(screen.getByText(/empty/i)).toBeInTheDocument();
  });

  it('renders the error-handling section with triggers + escalation', () => {
    render(
      <ObservabilityPlanWidget
        config={{
          intent: 'support triage',
          error_handling: {
            triggers: ['tool timeout', 'auth refresh fail'],
            escalation: 'manual_reviews queue with tag=triage',
          },
        }}
      />,
    );
    expect(screen.getByText('tool timeout')).toBeInTheDocument();
    expect(screen.getByText('auth refresh fail')).toBeInTheDocument();
    expect(
      screen.getByText(/manual_reviews queue with tag=triage/),
    ).toBeInTheDocument();
  });

  it('renders the success-metric section with kind + description', () => {
    render(
      <ObservabilityPlanWidget
        config={{
          success_metric: {
            kind: 'count_by_status',
            description: 'Weekly rollup approved / escalated / dropped',
            target: 'Approved >70% week-over-week',
          },
        }}
      />,
    );
    expect(screen.getByText(/Count by status/)).toBeInTheDocument();
    expect(screen.getByText(/Weekly rollup/)).toBeInTheDocument();
    expect(screen.getByText(/Approved >70%/)).toBeInTheDocument();
  });

  it('handles all four metric kinds, each with its own label', () => {
    // Asserting only that the section exists passed with every kind collapsed
    // onto the `custom` label. Each kind must name itself, and no two may share
    // a label.
    const kinds = ['count_by_status', 'cost_per_run', 'latency', 'custom'] as const;
    const labels = kinds.map((kind) => {
      const { unmount } = render(
        <ObservabilityPlanWidget
          config={{ success_metric: { kind, description: 'DESC' } }}
        />,
      );
      const section = document.querySelector('[data-section="success-metric"]');
      expect(section).not.toBeNull();
      const text = (section?.textContent ?? '').replace('DESC', '').trim();
      unmount();
      return text;
    });
    expect(labels.every((l) => l.length > 0)).toBe(true);
    expect(new Set(labels).size).toBe(kinds.length);
  });
});
