/**
 * The analyze step must say WHICH connectors need a vault item.
 *
 * `analyzeCredentialGaps` ranked connectors ready / ambiguous / missing and
 * had zero UI consumers - a grep for it matched only its own definition. The
 * wizard footer received a `connectorsMissing` COUNT and disabled later steps
 * on it without ever naming one, so users reached Process with Matrix with
 * silent credential holes.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConnectorsSection } from '../N8nParserResultsSections';
import { useVaultStore } from '@/stores/vaultStore';
import type { CredentialMetadata } from '@/lib/types/types';

const cred = (id: string, name: string, service_type: string): CredentialMetadata =>
  ({ id, name, service_type }) as unknown as CredentialMetadata;

const connectors = [
  { name: 'slack', credential_fields: [], related_tools: [], related_triggers: [] },
  { name: 'github', credential_fields: [], related_tools: [], related_triggers: [] },
  { name: 'notion', credential_fields: [], related_tools: [], related_triggers: [] },
];

const setCredentials = (credentials: CredentialMetadata[]) => {
  useVaultStore.setState({ credentials } as never);
};

beforeEach(() => {
  setCredentials([]);
});

const status = (name: string) =>
  screen.getByTestId(`connector-gap-${name}`).getAttribute('data-status');

describe('ConnectorsSection credential gaps', () => {
  it('renders all three statuses for a three-connector fixture', () => {
    setCredentials([
      // github: exactly one match -> ready
      cred('c1', 'Work GitHub', 'github'),
      // slack: two matches -> ambiguous
      cred('c2', 'Team Slack', 'slack'),
      cred('c3', 'Personal Slack', 'slack'),
      // notion: nothing -> missing
    ]);
    render(<ConnectorsSection connectors={connectors} hasSelection={false} />);

    expect(status('github')).toBe('ready');
    expect(status('slack')).toBe('ambiguous');
    expect(status('notion')).toBe('missing');
  });

  it('names the ambiguous candidates, since the user has to pick one', () => {
    setCredentials([cred('c2', 'Team Slack', 'slack'), cred('c3', 'Personal Slack', 'slack')]);
    render(<ConnectorsSection connectors={[connectors[0]!]} hasSelection={false} />);
    const chip = screen.getByTestId('connector-gap-slack').textContent ?? '';
    expect(chip).toContain('Team Slack');
    expect(chip).toContain('Personal Slack');
  });

  it('offers the Vault only when something is actually missing', () => {
    setCredentials([cred('c1', 'Work GitHub', 'github')]);
    render(<ConnectorsSection connectors={[connectors[1]!]} hasSelection={false} />);
    expect(screen.queryByTestId('connector-gaps-open-vault')).toBeNull();

    render(<ConnectorsSection connectors={[connectors[2]!]} hasSelection={false} />);
    expect(screen.getAllByTestId('connector-gaps-open-vault').length).toBeGreaterThan(0);
  });

  it('ignores an unselected connector - it is not going to be built', () => {
    setCredentials([]);
    render(
      <ConnectorsSection
        connectors={connectors}
        selectedConnectorNames={new Set(['slack'])}
        hasSelection
      />,
    );
    expect(screen.getByTestId('connector-gap-slack')).toBeTruthy();
    expect(screen.queryByTestId('connector-gap-github')).toBeNull();
    expect(screen.queryByTestId('connector-gap-notion')).toBeNull();
  });
});
