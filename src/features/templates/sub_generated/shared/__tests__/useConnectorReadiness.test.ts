import { describe, it, expect } from 'vitest';
import { resolveConnectorStatuses } from '../useConnectorReadiness';
import type { ConnectorReadinessMap, ResolvedConnectorReadiness } from '../useConnectorReadiness';

function map(entries: ResolvedConnectorReadiness[]): ConnectorReadinessMap {
  return new Map(entries.map((e) => [e.connector_name.toLowerCase(), e]));
}

describe('resolveConnectorStatuses', () => {
  it('never invents a verdict the resolver has not given', () => {
    // The whole point of the unfork: an unanswered connector is `unknown`,
    // NOT `ready` (which would promise a run the gate blocks) and NOT
    // `missing` (which would hide a template that works).
    const statuses = resolveConnectorStatuses(['slack'], map([]));
    expect(statuses).toEqual([
      { connector_name: 'slack', health: 'unknown', setup_kind: null },
    ]);
  });

  it('reports zero-config connectors as ready even with no credential', () => {
    // The retired TS heuristic was `installed && has_credential`, so a
    // zero-config connector (which has no credential by definition) always
    // read as not-ready.
    const statuses = resolveConnectorStatuses(
      ['local_drive'],
      map([{ connector_name: 'local_drive', health: 'ready', setup_kind: null }]),
    );
    expect(statuses[0].health).toBe('ready');
  });

  it('carries the routing kind for a not-ready connector', () => {
    const statuses = resolveConnectorStatuses(
      ['vercel'],
      map([{ connector_name: 'vercel', health: 'missing', setup_kind: 'cli_login' }]),
    );
    expect(statuses[0]).toMatchObject({ health: 'missing', setup_kind: 'cli_login' });
  });

  it('matches case-insensitively but echoes the caller spelling', () => {
    // Downstream lookups are `find(s => s.connector_name === c)` against the
    // template's own spelling, so the projection must not re-case names.
    const statuses = resolveConnectorStatuses(
      ['Notion'],
      map([{ connector_name: 'notion', health: 'ready', setup_kind: null }]),
    );
    expect(statuses[0].connector_name).toBe('Notion');
    expect(statuses[0].health).toBe('ready');
  });

  it('de-duplicates the declared + suggested union and drops blanks', () => {
    // Callers pass `[...connectors, ...suggested_connectors]`, which overlap.
    const statuses = resolveConnectorStatuses(
      ['slack', { name: 'Slack' }, '  ', { name: 'notion' }],
      map([{ connector_name: 'slack', health: 'ready', setup_kind: null }]),
    );
    expect(statuses.map((s) => s.connector_name)).toEqual(['slack', 'notion']);
  });

  it('accepts both bare names and suggested-connector objects', () => {
    const statuses = resolveConnectorStatuses(
      [{ name: 'gmail' }],
      map([{ connector_name: 'gmail', health: 'missing', setup_kind: 'vault_credential' }]),
    );
    expect(statuses[0]).toMatchObject({
      connector_name: 'gmail',
      health: 'missing',
      setup_kind: 'vault_credential',
    });
  });
});
