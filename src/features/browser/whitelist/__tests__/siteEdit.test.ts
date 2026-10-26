// @vitest-environment node
import { describe, expect, it } from 'vitest';

import type { BrowserSite } from '../../types';
import { draftFromSite, parseBudget, planSiteWrites } from '../siteEdit';

function site(patch: Partial<BrowserSite> = {}): BrowserSite {
  return {
    origin: 'https://app.example.com',
    label: 'App',
    enabled: true,
    overrides: {},
    budget: 50,
    credentialId: null,
    scanStatus: 'confirmed',
    scanTier: 2,
    scanReport: {
      pageTools: [
        { name: 'delete_item', description: '', reversible: false, sideEffects: 'external', class: 'gated' },
        { name: 'search', description: '', reversible: true, sideEffects: 'none', class: 'auto' },
      ],
    } as unknown as BrowserSite['scanReport'],
    scanAt: null,
    firstSeen: 0,
    lastSeen: 0,
    createdBy: 'operator',
    ...patch,
  };
}

describe('draftFromSite', () => {
  it('lists every scanned tool with whether it is forced to ask first', () => {
    const draft = draftFromSite(site({ overrides: { search: 'gated' } }));
    expect(draft).toEqual({
      label: 'App',
      budget: '50',
      credentialId: null,
      gated: { delete_item: false, search: true },
    });
  });

  it('has no tools when the site was never scanned', () => {
    expect(draftFromSite(site({ scanReport: null })).gated).toEqual({});
  });

  // The ledger's WritesChip counts every stored override; a scan that is
  // running (Rust nulls `scanReport` while it runs), failed, or no longer
  // lists the tool must not hide an override the operator can then never clear.
  it('lists a stored override even when the current scan does not report that tool', () => {
    const unscanned = site({ scanReport: null, overrides: { submit_form: 'gated' } });
    expect(draftFromSite(unscanned).gated).toEqual({ submit_form: true });
    const dropped = site({ overrides: { old_tool: 'gated' } });
    expect(draftFromSite(dropped).gated).toEqual({ delete_item: false, search: false, old_tool: true });
  });

  it('can clear an override whose tool the scan no longer reports', () => {
    const s = site({ scanReport: null, overrides: { submit_form: 'gated' } });
    expect(planSiteWrites(s, { ...draftFromSite(s), gated: { submit_form: false } })).toEqual([
      { kind: 'override', tool: 'submit_form', gated: false },
    ]);
  });
});

describe('parseBudget', () => {
  it.each([
    ['0', 0],
    ['50', 50],
    [' 120 ', 120],
  ])('parses %j', (raw, n) => {
    expect(parseBudget(raw)).toBe(n);
  });

  it.each(['', '-1', '1.5', 'ten', '1e3'])('refuses %j', (raw) => {
    expect(parseBudget(raw)).toBeNull();
  });
});

describe('planSiteWrites', () => {
  it('plans nothing for an untouched draft', () => {
    const s = site({ overrides: { search: 'gated' }, credentialId: 'cred-1' });
    expect(planSiteWrites(s, draftFromSite(s))).toEqual([]);
  });

  it('folds a rename and a budget change into one upsert, sending null for what did not change', () => {
    const s = site();
    expect(planSiteWrites(s, { ...draftFromSite(s), label: ' Renamed ' })).toEqual([
      { kind: 'upsert', label: 'Renamed', budget: null },
    ]);
    expect(planSiteWrites(s, { ...draftFromSite(s), budget: '10' })).toEqual([
      { kind: 'upsert', label: null, budget: 10 },
    ]);
  });

  it('treats a blank name as "keep", like the add form', () => {
    const s = site();
    expect(planSiteWrites(s, { ...draftFromSite(s), label: '  ' })).toEqual([]);
  });

  it('binds and unbinds a credential', () => {
    const s = site();
    expect(planSiteWrites(s, { ...draftFromSite(s), credentialId: 'cred-9' })).toEqual([
      { kind: 'credential', credentialId: 'cred-9' },
    ]);
    const bound = site({ credentialId: 'cred-9' });
    expect(planSiteWrites(bound, { ...draftFromSite(bound), credentialId: null })).toEqual([
      { kind: 'credential', credentialId: null },
    ]);
  });

  it('is tighten-only: a tool is either forced to ask first or reset, never set to another class', () => {
    const s = site({ overrides: { search: 'gated' } });
    const writes = planSiteWrites(s, { ...draftFromSite(s), gated: { delete_item: true, search: false } });
    expect(writes).toEqual([
      { kind: 'override', tool: 'delete_item', gated: true },
      { kind: 'override', tool: 'search', gated: false },
    ]);
    for (const w of writes) expect(Object.keys(w).sort()).toEqual(['gated', 'kind', 'tool']);
  });

  it('never writes an invalid budget', () => {
    const s = site();
    expect(planSiteWrites(s, { ...draftFromSite(s), budget: 'abc' })).toEqual([]);
  });
});
