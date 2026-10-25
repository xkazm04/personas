// @vitest-environment node
import { describe, it, expect } from 'vitest';
import type { CredentialMetadata } from '@/lib/types/types';
import { filterAndSortCredentials } from '../credentialListTypes';

// Only the fields the sort reads; the rest is irrelevant to the health order.
function cred(id: string, state: string | null, success: boolean | null): CredentialMetadata {
  return {
    id,
    name: id,
    service_type: 'x',
    metadata: state ? JSON.stringify({ healthcheck_last_state: state }) : null,
    healthcheck_last_success: success,
    healthcheck_last_message: null,
    created_at: '2026-01-01T00:00:00Z',
    last_used_at: null,
  } as unknown as CredentialMetadata; // test fixture: only the sort-read fields are populated
}

describe('filterAndSortCredentials health sort', () => {
  it('ranks an unverifiable credential below a verified one (typed state, not the stored boolean)', () => {
    // Backend stores success=true for "could not check"; the boolean alone makes both look 100.
    const verified = cred('verified', 'verified', true);
    const unverifiable = cred('unverifiable', 'unverifiable', true);
    const out = filterAndSortCredentials(
      [verified, unverifiable],
      { sortKey: 'health', sortDirection: 'asc' },
      () => undefined,
    );
    expect(out.map((c) => c.id)).toEqual(['unverifiable', 'verified']);
  });
});
