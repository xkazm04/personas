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
    credential_id: null,
    scan_status: 'confirmed',
    scan_tier: 2,
    scan_report: {
      page_tools: [
        { name: 'delete_item', description: '', reversible: false, side_effects: 'external', class: 'gated' },
        { name: 'search', description: '', reversible: true, side_effects: 'none', class: 'auto' },
      ],
    } as unknown as BrowserSite['scan_report'],
    scan_at: null,
    first_seen: 0,
    last_seen: 0,
    created_by: 'operator',
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
    expect(draftFromSite(site({ scan_report: null })).gated).toEqual({});
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
    const s = site({ overrides: { search: 'gated' }, credential_id: 'cred-1' });
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
    const bound = site({ credential_id: 'cred-9' });
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
