import { describe, expect, it } from 'vitest';
import { deriveConnectorAttention, type ConnectorAttentionFields } from './connectorAttention';

function cred(over: Partial<ConnectorAttentionFields>): ConnectorAttentionFields {
  return {
    id: 'c1',
    name: 'Cred',
    service_type: 'github',
    metadata: null,
    healthcheck_last_success: null,
    healthcheck_last_message: null,
    ...over,
  };
}

describe('deriveConnectorAttention', () => {
  it('ignores healthy, untested and unparseable credentials', () => {
    expect(
      deriveConnectorAttention([
        cred({ id: 'a', healthcheck_last_success: true }),
        cred({ id: 'b' }),
        cred({ id: 'c', metadata: '{not json' }),
      ]),
    ).toEqual([]);
  });

  it('classifies revoked OAuth, expired CLI and failed probes', () => {
    const items = deriveConnectorAttention([
      cred({ id: 'probe', name: 'Probe', healthcheck_last_success: false, healthcheck_last_message: '401' }),
      cred({ id: 'cli', name: 'Cli', metadata: JSON.stringify({ needs_reauth: true, source: 'cli' }) }),
      cred({ id: 'oauth', name: 'OAuth', metadata: JSON.stringify({ needs_reauth: true }) }),
    ]);
    expect(items.map((i) => [i.credentialId, i.kind, i.detail])).toEqual([
      ['oauth', 'reauth', null],
      ['cli', 'cli_expired', null],
      ['probe', 'healthcheck_failed', '401'],
    ]);
  });

  it('reports a revoked credential once, as reauth, even when its probe also failed', () => {
    const items = deriveConnectorAttention([
      cred({ metadata: JSON.stringify({ needs_reauth: true }), healthcheck_last_success: false }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]!.kind).toBe('reauth');
  });
});
