import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConnectorCallCard } from '../../../../../plugins/companion/ConnectorCallCard';
import type { BackgroundJob } from '@/api/companion';

function job(over: Partial<BackgroundJob> = {}): BackgroundJob {
  return {
    id: 'job_abc',
    kind: 'connector_use',
    status: 'queued',
    paramsJson: JSON.stringify({
      connector_name: 'slack',
      capability: 'list_channels',
    }),
    resultText: null,
    errorText: null,
    projectId: null,
    createdAt: '2026-05-16T13:30:00Z',
    startedAt: null,
    completedAt: null,
    ...over,
  };
}

describe('ConnectorCallCard', () => {
  it('renders the connector name and capability (humanized)', () => {
    // ConnectorCallCard humanizes the raw service-type + capability slugs
    // via athenaLabels.{connectorDisplayName, capabilityLabel}. Users
    // never see "slack · list_channels" — they see "Slack · Your channels".
    render(<ConnectorCallCard job={job()} />);
    expect(screen.getByText('Slack')).toBeInTheDocument();
    expect(screen.getByText('Your channels')).toBeInTheDocument();
  });

  it('shows the queued status label when job is queued', () => {
    render(<ConnectorCallCard job={job({ status: 'queued' })} />);
    expect(screen.getByText(/queued/i)).toBeInTheDocument();
  });

  it('shows the running status label when job is running', () => {
    render(<ConnectorCallCard job={job({ status: 'running' })} />);
    expect(screen.getByText(/running/i)).toBeInTheDocument();
  });

  it('shows the done status label and expandable body when completed', () => {
    render(
      <ConnectorCallCard
        job={job({
          status: 'completed',
          resultText: '## Slack\n\n5 channels visible',
          completedAt: '2026-05-16T13:31:00Z',
        })}
      />,
    );
    expect(screen.getByText(/done/i)).toBeInTheDocument();
    // body is collapsed by default — text only appears after click
    expect(screen.queryByText(/5 channels visible/i)).toBeNull();
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText(/5 channels visible/i)).toBeInTheDocument();
  });

  it('shows the failed status label and error body when failed', () => {
    render(
      <ConnectorCallCard
        job={job({
          status: 'failed',
          errorText: 'auth_token missing',
        })}
      />,
    );
    expect(screen.getByText(/failed/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('auth_token missing')).toBeInTheDocument();
  });

  it('exposes the job id + status in data attributes', () => {
    render(<ConnectorCallCard job={job({ status: 'completed', resultText: 'ok' })} />);
    const card = screen.getByTestId('companion-connector-call-card');
    expect(card.getAttribute('data-job-id')).toBe('job_abc');
    expect(card.getAttribute('data-job-status')).toBe('completed');
  });

  it('tolerates malformed paramsJson without crashing', () => {
    render(<ConnectorCallCard job={job({ paramsJson: 'not-json' })} />);
    // Renders as two `?` for connector_name + capability when params parse fails
    const cells = screen.getAllByText('?');
    expect(cells.length).toBeGreaterThanOrEqual(2);
  });
});
