import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DecisionLogWidget } from '../DecisionLogWidget';

describe('DecisionLogWidget', () => {
  it('shows the empty state when no decisions', () => {
    render(<DecisionLogWidget config={{ decisions: [] }} />);
    expect(screen.getByText(/hasn't logged/i)).toBeInTheDocument();
  });

  it('renders each decision as a label → choice row', () => {
    render(
      <DecisionLogWidget
        config={{
          intent: 'support triage bot',
          decisions: [
            {
              label: 'Model tier',
              choice: 'Sonnet',
              rationale: 'Drafts need capability, not max.',
            },
            {
              label: 'Use case split',
              choice: 'Three',
              rationale: 'Golden + 1 variant + 1 out-of-scope.',
            },
          ],
        }}
      />,
    );
    expect(screen.getByText('Model tier')).toBeInTheDocument();
    expect(screen.getByText('Sonnet')).toBeInTheDocument();
    expect(screen.getByText('Use case split')).toBeInTheDocument();
    expect(screen.getByText('Three')).toBeInTheDocument();
    expect(screen.getByText(/Drafts need capability/)).toBeInTheDocument();
  });

  it('shows the persisted "Saved" badge in the header', () => {
    render(
      <DecisionLogWidget
        config={{
          decisions: [
            { label: 'A', choice: 'B', rationale: 'why' },
          ],
        }}
      />,
    );
    // badge from decision_log_persisted_badge i18n key
    expect(screen.getByText(/saved/i)).toBeInTheDocument();
  });

  it('drops rows missing required fields silently', () => {
    render(
      <DecisionLogWidget
        config={{
          decisions: [
            { label: 'Valid', choice: 'Yes', rationale: 'because' },
            { label: '', choice: 'X', rationale: 'no label' }, // dropped
            { label: 'NoChoice', choice: '', rationale: 'incomplete' }, // dropped
          ],
        }}
      />,
    );
    expect(screen.getByText('Valid')).toBeInTheDocument();
    expect(screen.queryByText('NoChoice')).toBeNull();
  });
});
