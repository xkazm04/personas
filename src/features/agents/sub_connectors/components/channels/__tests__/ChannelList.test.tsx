import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChannelList } from '../ChannelList';
import type { CredentialMetadata } from '@/lib/types/types';

vi.mock('@/api/agents/channelDelivery', () => ({
  testNotificationChannel: vi.fn().mockResolvedValue('ok'),
}));

// Cast: the picker reads only id/name/service_type; the remaining metadata
// fields are irrelevant to credential matching.
const slackCred = {
  id: 'cred-slack-1',
  name: 'Team Slack Webhook',
  service_type: 'slack',
  serviceType: 'slack',
} as unknown as CredentialMetadata;

/**
 * The draft editor rendered this list with an empty connector catalog, and
 * matching required the catalog entry to exist, so the credential picker was
 * always empty. A vault credential must be offered on its service type alone.
 */
describe('ChannelList credential matching', () => {
  it('offers a vault credential even when the connector catalog is not loaded', () => {
    render(
      <ChannelList
        channels={[{ type: 'slack', enabled: true, config: {}, credential_id: 'cred-slack-1' }]}
        credentials={[slackCred]}
        connectorDefinitions={[]}
        validationErrors={[]}
        existingTypes={new Set(['slack'])}
        onToggleEnabled={() => {}}
        onRemove={() => {}}
        onConfigChange={() => {}}
        onCredentialChange={() => {}}
        onAdd={() => {}}
      />,
    );
    expect(screen.getByText('Team Slack Webhook')).toBeTruthy();
  });
});
