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
    // The rationale shows in the row and again as its Hint's always-present description.
    expect(screen.getAllByText(/Drafts need capability/)[0]).toBeInTheDocument();
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
    // The empty-LABEL row is the other half of the filter: its choice and its
    // rationale must not surface either (a filter on `choice` alone kept it).
    expect(screen.queryByText('X')).toBeNull();
    expect(screen.queryByText('no label')).toBeNull();
  });
});

/**
 * `prettyTime` formatted with `toLocale*String(undefined, ...)`, the host OS
 * locale, while TimelineWidget in the same folder formats with the app's
 * language. A UI set to German showed the machine's date shape.
 */
describe('DecisionLogWidget time follows the app language', () => {
  it('formats an older decision in the active language, not the host locale', async () => {
    const { useI18nStore } = await import('@/stores/i18nStore');
    const before = useI18nStore.getState().language;
    useI18nStore.setState({ language: 'de' });
    try {
      const at = '2026-03-05T14:05:00Z';
      const expected = new Date(at).toLocaleDateString('de', { month: 'short', day: 'numeric' });
      // The control: the probe is meaningless if the host already formats as German.
      const host = Intl.DateTimeFormat().resolvedOptions().locale;
      expect(expected).not.toBe(new Date(at).toLocaleDateString(host, { month: 'short', day: 'numeric' }));
      render(
        <DecisionLogWidget
          config={{ decisions: [{ label: 'Model tier', choice: 'Sonnet', rationale: 'r', timestamp: at }] }}
        />,
      );
      expect(screen.getByText(expected)).toBeInTheDocument();
    } finally {
      useI18nStore.setState({ language: before });
    }
  });
});
