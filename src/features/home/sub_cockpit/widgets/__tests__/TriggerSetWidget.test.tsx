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
    expect(screen.getByText(/Body contains "incident"/)).toBeInTheDocument();
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
    expect(screen.getByText(/One message → one triage response/)).toBeInTheDocument();
    expect(screen.getByText(/dedupe on Slack ts/)).toBeInTheDocument();
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
    // The empty-label row is filtered, so only one rendered li
    const items = document.querySelectorAll('li');
    expect(items.length).toBe(1);
  });
});
