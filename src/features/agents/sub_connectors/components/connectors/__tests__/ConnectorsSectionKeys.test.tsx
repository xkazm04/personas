/**
 * A card's identity is its connector name. The key used to append the card's
 * index within its role group, so when a health filter hid an earlier member
 * every later card's key shifted, React unmounted and remounted it, and its
 * local state (the open swap picker) was thrown away - the same defect the
 * group key's own comment describes fixing one level up. Connector names are
 * unique within a persona's rows (`requiredCredTypes` is built from a Set).
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { ConnectorStatus } from '../../../libs/connectorTypes';

const mounts: string[] = [];

vi.mock('../ConnectorStatusCard', async () => {
  const React = await import('react');
  return {
    ConnectorStatusCard: ({ status }: { status: ConnectorStatus }) => {
      React.useState(() => { mounts.push(status.name); return null; });
      return React.createElement('div', { 'data-testid': `card-${status.name}` });
    },
  };
});

import { ConnectorsSection } from '../ConnectorsTabSections';

function status(name: string): ConnectorStatus {
  return { name, credentialId: null, credentialName: null, testing: false, result: null, linkError: null };
}

function renderSection(items: ConnectorStatus[]) {
  return (
    <ConnectorsSection
      roleGroups={[{ roleLabel: 'Messaging', items }]}
      requiredCredTypes={['slack', 'discord']}
      healthy={0} unhealthy={0} unlinked={2} unverifiable={0} staleCount={0}
      testableCount={0} testingAll={false} credentials={[]} linkingConnector={null}
      onTestAll={() => {}} onTestConnector={() => {}} onToggleLinking={() => {}}
      onLink={() => {}} onAddCredential={() => {}} onClearLinkError={() => {}} onSwap={() => {}}
    />
  );
}

describe('ConnectorsSection card identity', () => {
  it('hiding an earlier group member does not remount the cards after it', () => {
    mounts.length = 0;
    const { rerender, getByTestId } = render(renderSection([status('slack'), status('discord')]));
    expect(mounts).toEqual(['slack', 'discord']);

    rerender(renderSection([status('discord')]));

    expect(getByTestId('card-discord')).toBeTruthy();
    expect(mounts).toEqual(['slack', 'discord']);
  });
});
