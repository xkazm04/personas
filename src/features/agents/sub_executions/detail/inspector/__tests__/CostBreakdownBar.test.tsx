import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CostBreakdownBar } from '../CostBreakdownBar';

// claude-sonnet-4 is priced $3/1M input, $15/1M output.
// 1,000,000 input + 1,000,000 output => $3 input, $15 output, $18 priced total.
const SONNET = 'claude-sonnet-4';
const ONE_M = 1_000_000;

describe('CostBreakdownBar', () => {
  it('splits the priced total when no authoritative cost is supplied', () => {
    render(<CostBreakdownBar model={SONNET} inputTokens={ONE_M} outputTokens={ONE_M} />);
    expect(screen.getByText(/Input: \$3\.0000/)).toBeTruthy();
    expect(screen.getByText(/Output: \$15\.0000/)).toBeTruthy();
    expect(screen.getByText(/Total: \$18\.0000/)).toBeTruthy();
  });

  it('reports the authoritative total, not a second computed one', () => {
    // The run really cost $9 — half what the list price implies. The component
    // must show $9, not $18: TraceSummary shows the same number.
    render(
      <CostBreakdownBar model={SONNET} inputTokens={ONE_M} outputTokens={ONE_M} actualCostUsd={9} />,
    );
    expect(screen.getByText(/Total: \$9\.0000/)).toBeTruthy();
    expect(screen.queryByText(/\$18\.0000/)).toBeNull();
  });

  it('apportions the authoritative total by the priced ratio', () => {
    // 1:5 input:output ratio applied to a $9 actual => $1.50 / $7.50.
    render(
      <CostBreakdownBar model={SONNET} inputTokens={ONE_M} outputTokens={ONE_M} actualCostUsd={9} />,
    );
    expect(screen.getByText(/Input: \$1\.5000/)).toBeTruthy();
    expect(screen.getByText(/Output: \$7\.5000/)).toBeTruthy();
  });

  it('shows the split percentages that match the apportioned costs', () => {
    render(<CostBreakdownBar model={SONNET} inputTokens={ONE_M} outputTokens={ONE_M} />);
    expect(screen.getByText(/Input \(17%\)/)).toBeTruthy();
    expect(screen.getByText(/Output \(83%\)/)).toBeTruthy();
  });

  it('suppresses the split for an unrecognised model rather than inventing 50/50', () => {
    render(
      <CostBreakdownBar
        model="some-unknown-model-v9"
        inputTokens={ONE_M}
        outputTokens={ONE_M}
        actualCostUsd={2.4}
      />,
    );
    // Total is still the truth we have...
    expect(screen.getByText(/Total: \$2\.4000/)).toBeTruthy();
    // ...but no fabricated decomposition.
    expect(screen.queryByText(/Input: /)).toBeNull();
    expect(screen.queryByText(/Input \(/)).toBeNull();
  });

  it('flags an unrecognised model so the figure is not read as exact', () => {
    render(<CostBreakdownBar model="some-unknown-model-v9" inputTokens={ONE_M} outputTokens={ONE_M} />);
    expect(screen.getByText(/Unknown model/i)).toBeTruthy();
  });

  it('reframes a Claude run as subscription-included', () => {
    render(<CostBreakdownBar model={SONNET} inputTokens={ONE_M} outputTokens={ONE_M} actualCostUsd={9} />);
    const note = screen.getByTestId('subscription-cost-note');
    // The reframe restates the SAME total — it must never introduce a new number.
    expect(note.textContent).toContain('$9.0000');
  });

  it('does not reframe an external-API model as subscription-included', () => {
    render(<CostBreakdownBar model="gpt-4o" inputTokens={ONE_M} outputTokens={ONE_M} actualCostUsd={9} />);
    expect(screen.queryByTestId('subscription-cost-note')).toBeNull();
  });
});
