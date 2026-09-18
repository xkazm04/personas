/**
 * `useUnfulfilledCredentials` has always computed `reusableCount` and nothing
 * ever consumed it as an action, so a persona needing five connector types was
 * five Create/Reuse clicks even when the vault already held a verified
 * credential for four of them.
 *
 * What these cases defend is the REFUSAL, not the batch. A machine may settle a
 * slot only when there is exactly one verified candidate; two verified
 * candidates is the machine guessing which account the persona acts as, and an
 * unverified candidate is a visible "needs setup" traded for an invisible
 * runtime auth failure. Both must stay with the human, and a test that only
 * proved "it links things" would pass while silently doing either.
 */
import { describe, it, expect } from 'vitest';
import type { CredentialMetadata } from '@/lib/types/types';
import type { UnfulfilledCredential } from '../useUnfulfilledCredentials';
import { partitionDemands } from '../fulfillDemands';

function cred(id: string): CredentialMetadata {
  return { id, name: id } as unknown as CredentialMetadata;
}

function demand(connectorName: string, matches: CredentialMetadata[]): UnfulfilledCredential {
  return {
    connectorName,
    connectorLabel: connectorName,
    connectorColor: '#fff',
    connectorCategory: 'other',
    personaId: 'p1',
    personaName: 'P',
    personaColor: '#fff',
    matchingCredentials: matches,
  };
}

/** Stands in for `isCredentialVerified`; ids prefixed `v-` are verified. */
const verified = (c: CredentialMetadata) => c.id.startsWith('v-');

describe('partitionDemands', () => {
  it('auto-links exactly the slots with one verified match', () => {
    const p = partitionDemands([
      demand('github', [cred('v-gh')]),
      demand('slack', [cred('v-slack')]),
    ], verified);

    expect(p.autoLinkable.map((a) => [a.demand.connectorName, a.credentialId])).toEqual([
      ['github', 'v-gh'],
      ['slack', 'v-slack'],
    ]);
    expect(p.ambiguous).toEqual([]);
    expect(p.missing).toEqual([]);
  });

  it('refuses to choose between two verified credentials', () => {
    const p = partitionDemands([demand('github', [cred('v-work'), cred('v-personal')])], verified);

    expect(p.autoLinkable).toEqual([]);
    expect(p.ambiguous.map((d) => d.connectorName)).toEqual(['github']);
  });

  it('refuses an unverified match even when it is the only one', () => {
    const p = partitionDemands([demand('gmail', [cred('u-gmail')])], verified);

    expect(p.autoLinkable).toEqual([]);
    expect(p.ambiguous.map((d) => d.connectorName)).toEqual(['gmail']);
    // Not `missing` either: the vault does hold a candidate, it just has not
    // proven it works, so the per-row picker is the right door.
    expect(p.missing).toEqual([]);
  });

  it('ignores unverified noise around a single verified match', () => {
    const p = partitionDemands([demand('slack', [cred('u-old'), cred('v-live'), cred('u-older')])], verified);

    expect(p.autoLinkable).toEqual([{ demand: expect.anything(), credentialId: 'v-live' }]);
  });

  it('routes a slot with no candidate at all to creation', () => {
    const p = partitionDemands([demand('n8n', [])], verified);

    expect(p.missing.map((d) => d.connectorName)).toEqual(['n8n']);
    expect(p.autoLinkable).toEqual([]);
    expect(p.ambiguous).toEqual([]);
  });

  it('partitions a mixed roster into all three buckets', () => {
    const p = partitionDemands([
      demand('github', [cred('v-gh')]),
      demand('slack', [cred('v-a'), cred('v-b')]),
      demand('gmail', [cred('u-g')]),
      demand('n8n', []),
      demand('openai', []),
    ], verified);

    expect(p.autoLinkable.map((a) => a.demand.connectorName)).toEqual(['github']);
    expect(p.ambiguous.map((d) => d.connectorName)).toEqual(['slack', 'gmail']);
    expect(p.missing.map((d) => d.connectorName)).toEqual(['n8n', 'openai']);
  });
});
