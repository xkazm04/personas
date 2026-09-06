import { describe, it, expect } from 'vitest';
import { resolveRoles } from '../components/CharterConnectorTypes';

/**
 * The three states exist because the catalog really does produce all three.
 * Measured 2026-09-06 over `scripts/connectors/builtin/*.json`: `analytics` has
 * many candidates, `support` has exactly one, and `legal` has none at all - the
 * catalog carries no e-signature or contract connector. Collapsing the last into
 * "not bound" would tell the operator to bind something that does not exist.
 */
describe('resolveRoles', () => {
  it('reports a type the charter has covered as bound', () => {
    const rows = resolveRoles(['analytics'], undefined, ['posthog']);
    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe('bound');
    expect(rows[0].bound).toEqual(['posthog']);
    expect(rows[0].role).toBe('analytics');
    expect(rows[0].named).toBe(false);
  });

  it('accepts a connector id with or without the builtin- prefix', () => {
    expect(resolveRoles(['analytics'], undefined, ['builtin-posthog'])[0].state).toBe('bound');
  });

  it('separates "nothing bound yet" from "nothing in the catalog can cover this"', () => {
    expect(resolveRoles(['analytics'], undefined, [])[0].state).toBe('unbound');
    expect(resolveRoles(['legal'], undefined, [])[0].state).toBe('uncovered');
  });

  it('tolerates a type carried by exactly one connector', () => {
    const row = resolveRoles(['support'], undefined, [])[0];
    expect(['unbound', 'uncovered']).toContain(row.state);
    // Whichever it is, resolution does not throw and does not drop the row.
    expect(row.type).toBe('support');
  });

  it('returns no rows at all when the charter declares nothing', () => {
    expect(resolveRoles(undefined, undefined, ['posthog'])).toEqual([]);
    expect(resolveRoles([], [], ['posthog'])).toEqual([]);
  });

  it('prefers per-role bindings over the flat type list', () => {
    const rows = resolveRoles(
      ['source_control'],
      [
        { role: 'local_checkout', connectorType: 'source_control', connector: 'github' },
        { role: 'review_surface', connectorType: 'source_control' },
      ],
      ['github'],
    );
    // Two roles of the SAME type, which a flat list structurally cannot express.
    expect(rows.map((r) => r.role)).toEqual(['local_checkout', 'review_surface']);
    expect(rows.every((r) => r.named)).toBe(true);
    expect(rows[0].bound).toEqual(['github']);
  });

  it('shows an unresolved role honestly instead of hiding the row', () => {
    const rows = resolveRoles(
      undefined,
      [{ role: 'contract_store', connectorType: 'legal' }],
      ['github'],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe('uncovered');
    expect(rows[0].bound).toEqual([]);
  });
});
