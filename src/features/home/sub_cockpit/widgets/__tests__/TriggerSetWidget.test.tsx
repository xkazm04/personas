import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TriggerSetWidget } from '../TriggerSetWidget';

describe('TriggerSetWidget', () => {
  it('renders empty state when no triggers', () => {
    render(<TriggerSetWidget config={{ triggers: [] }} />);
    expect(screen.getByText(/empty/i)).toBeInTheDocument();
  });

  it('renders each trigger with label / source / condition', () => {
    render(
      <TriggerSetWidget
        config={{
          intent: 'support triage',
          triggers: [
            {
              label: 'New Slack message in #ops',
              source: 'Slack webhook',
              condition: 'Body contains "incident"',
            },
          ],
        }}
      />,
    );
    expect(screen.getByText('New Slack message in #ops')).toBeInTheDocument();
    expect(screen.getByText('Slack webhook')).toBeInTheDocument();
    // The condition is the row's meta and also the full wording in its Hint.
    expect(screen.getAllByText(/Body contains "incident"/).length).toBeGreaterThan(0);
  });

  it('shows optional grain + idempotency notes when present', () => {
    render(
      <TriggerSetWidget
        config={{
          triggers: [
            {
              label: 'Inbound',
              source: 'Slack webhook',
              condition: 'message',
              grain: 'One message → one triage response.',
              idempotency_note: 'Webhook retries dedupe on Slack ts.',
            },
          ],
        }}
      />,
    );
    expect(screen.getAllByText(/One message → one triage response/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/dedupe on Slack ts/).length).toBeGreaterThan(0);
  });

  it('drops trigger rows missing a label', () => {
    render(
      <TriggerSetWidget
        config={{
          triggers: [
            { label: '', source: 'a', condition: 'b' },
            { label: 'Kept', source: 'a', condition: 'b' },
          ],
        }}
      />,
    );
    expect(screen.getByText('Kept')).toBeInTheDocument();
    // The empty-label row is filtered, so only one rendered row
    const items = document.querySelectorAll('[data-kit="ListRow"]');
    expect(items.length).toBe(1);
  });
});
