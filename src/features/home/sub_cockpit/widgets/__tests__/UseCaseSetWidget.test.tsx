import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UseCaseSetWidget } from '../UseCaseSetWidget';

describe('UseCaseSetWidget', () => {
  it('renders empty state when no use cases', () => {
    render(<UseCaseSetWidget config={{ use_cases: [] }} />);
    expect(screen.getByText(/empty/i)).toBeInTheDocument();
  });

  it('renders each use case with label and description', () => {
    render(
      <UseCaseSetWidget
        config={{
          intent: 'support triage',
          use_cases: [
            {
              label: 'Refund triage',
              role: 'golden',
              description: 'Inbound refund request → categorize + draft.',
            },
            {
              label: 'Refund + complaint',
              role: 'variant',
              description: 'Refund with a complaint angle.',
            },
            {
              label: 'Legal advice',
              role: 'out_of_scope',
              description: 'Refuse politely.',
            },
          ],
        }}
      />,
    );
    expect(screen.getByText('Refund triage')).toBeInTheDocument();
    expect(screen.getByText('Refund + complaint')).toBeInTheDocument();
    expect(screen.getByText('Legal advice')).toBeInTheDocument();
  });

  it('renders the correct role label per case', () => {
    render(
      <UseCaseSetWidget
        config={{
          use_cases: [
            { label: 'A', role: 'golden', description: 'd' },
            { label: 'B', role: 'variant', description: 'd' },
            { label: 'C', role: 'out_of_scope', description: 'd' },
          ],
        }}
      />,
    );
    // Each role now reads twice: once as the chip strip's count label, once as the row's
    // sr-only name prefix (the row's left accent draws the role but carries no text).
    expect(screen.getAllByText(/golden path/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/variant/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/out of scope/).length).toBeGreaterThan(0);
  });

  it('sorts golden → variant → out_of_scope regardless of input order', () => {
    const { container } = render(
      <UseCaseSetWidget
        config={{
          use_cases: [
            { label: 'OutA', role: 'out_of_scope', description: 'x' },
            { label: 'VarA', role: 'variant', description: 'x' },
            { label: 'GoldA', role: 'golden', description: 'x' },
          ],
        }}
      />,
    );
    // One shared-table row per use case, in render order.
    const labels = Array.from(container.querySelectorAll('[data-testid="companion-use-case-set-table"] .row-hover-lift')).map(
      (row) => row.textContent ?? '',
    );
    // Sequence must put golden first, then variant, then out_of_scope
    const goldIdx = labels.findIndex((s) => s.includes('GoldA'));
    const varIdx = labels.findIndex((s) => s.includes('VarA'));
    const outIdx = labels.findIndex((s) => s.includes('OutA'));
    expect(goldIdx).toBeLessThan(varIdx);
    expect(varIdx).toBeLessThan(outIdx);
  });
});
