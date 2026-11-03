// @vitest-environment node
/**
 * The Release card's composition (read only) and its one door out to bp
 * (spark one-control, WP3): the version bp's own rule suggests, the open
 * release shown as it stands, the URL built from the setting or its default,
 * and the reachability probe.
 */
import { describe, expect, it, vi } from 'vitest';

import type { Proposal, Release } from '@/lib/lensScan/wire';

import { BP_URL_DEFAULT, bpBaseUrl, bpReleaseUrl, bpSlug, bpSlugByRoot } from '../bpLink';
import { composeRelease, openReleaseOf, tagsFromReleases, versionOfReleaseId } from '../releaseComposition';
import { probeBp } from '../useBpRelease';

const T = '2026-10-15T10:00:00.000Z';
function prop(id: string, over: Partial<Proposal> = {}): Proposal {
  return { id, run_id: 'r1', feature: 'brew-timer', lens: 'development', title: `Item ${id}`, standard: 'none', kind: 'fix', status: 'accepted', created_at: T, updated_at: T, ...over };
}
function rel(version: string, status: Release['status'], over: Partial<Release> = {}): Release {
  return { id: `rel-${version}`, version, branch: `release/${version}`, status, created_at: T, updated_at: T, ...over };
}

describe('composeRelease', () => {
  it('suggests the next version from the store releases, patch for fixes only', () => {
    const scan = { proposals: [prop('a'), prop('b', { release_id: 'rel-0.3.0', status: 'released' })], releases: [rel('0.3.0', 'tagged')] };
    const c = composeRelease(scan);
    expect(c).toMatchObject({ version: '0.3.1', from: 'v0.3.0', bump: 'patch', waiting: false, notes: null, unreleasedCount: 1 });
    expect(c.items.map((p) => p.id)).toEqual(['a']);
  });

  it('a baseline upgrade among the items is a minor bump', () => {
    const scan = { proposals: [prop('a', { kind: 'baseline-upgrade' })], releases: [rel('0.3.0', 'tagged')] };
    expect(composeRelease(scan)).toMatchObject({ version: '0.4.0', bump: 'minor' });
  });

  it('passes over a version a release not yet tagged already holds', () => {
    const scan = { proposals: [prop('a')], releases: [rel('0.3.0', 'tagged'), rel('0.3.1', 'building')] };
    expect(composeRelease(scan).version).toBe('0.3.2');
  });

  it('with no release in the store, suggests what bp suggests with no tag: 0.1.0', () => {
    expect(composeRelease({ proposals: [prop('a')], releases: [] })).toMatchObject({ version: '0.1.0', from: null, bump: null });
  });

  it('shows a release waiting on the operator as it stands: its version, items and notes', () => {
    const scan = {
      proposals: [prop('a', { release_id: 'rel-1.2.0' }), prop('b')],
      releases: [rel('1.1.0', 'tagged'), rel('1.2.0', 'pr-open', { notes: '## Fixed\n- the timer', pr_url: 'https://example.test/pr/9' })],
    };
    const c = composeRelease(scan);
    expect(c).toMatchObject({ version: '1.2.0', waiting: true, notes: '## Fixed\n- the timer', unreleasedCount: 1 });
    expect(c.items.map((p) => p.id)).toEqual(['a']);
    expect(c.open).toMatchObject({ id: 'rel-1.2.0', status: 'pr-open' });
  });

  it('reads the tag list and the open release by semver, not by insertion order', () => {
    const releases = [rel('0.10.0', 'tagged'), rel('0.9.0', 'tagged'), rel('0.11.0', 'merged')];
    expect(tagsFromReleases(releases)).toEqual(['v0.11.0', 'v0.10.0', 'v0.9.0']);
    expect(openReleaseOf(releases)?.version).toBe('0.11.0');
    expect(versionOfReleaseId('rel-2.0.1')).toBe('2.0.1');
    expect(versionOfReleaseId('weird')).toBeNull();
  });
});

describe('the bp link', () => {
  it('builds the Release tab URL from the setting, or from the default when unset or blank', () => {
    expect(bpReleaseUrl(bpBaseUrl('http://bp.test:4000/'), 'teapot-works')).toBe('http://bp.test:4000/?product=teapot-works&page=ledger&tab=release');
    expect(bpReleaseUrl(bpBaseUrl(null), 'teapot-works')).toBe('http://localhost:3010/?product=teapot-works&page=ledger&tab=release');
    expect(bpBaseUrl('   ')).toBe(BP_URL_DEFAULT);
    expect(bpBaseUrl('javascript:alert(1)')).toBe(BP_URL_DEFAULT);
  });

  it('names the product by its repo folder, as bp slugs allow', () => {
    expect(bpSlug('C:/sample/teapot-works')).toBe('teapot-works');
    expect(bpSlug('C:\\sample\\Kiln Labs\\')).toBe('kiln-labs');
  });

  it("takes the slug from bp's product table by root: a worktree and a renamed slug resolve, an unknown root does not", () => {
    const rows = [
      { slug: 'personas', root: 'C:/t/hk-bp-ref-personas' },
      { slug: 'kettle-web', root: 'C:\\Users\\me\\demo\\Kettle_Web\\' },
      { slug: 'nameless' },
    ];
    expect(bpSlugByRoot(rows, 'c:\\t\\HK-BP-REF-PERSONAS')).toBe('personas');
    expect(bpSlugByRoot(rows, '//?/C:/Users/me/demo/kettle_web')).toBe('kettle-web');
    expect(bpSlug('C:/Users/me/demo/Kettle_Web')).toBe('kettle-web');
    expect(bpSlugByRoot(rows, 'C:/elsewhere/atlas')).toBeUndefined();
  });

  it('probes bp only where the webview may connect; a refused connection is down', async () => {
    expect(await probeBp('http://localhost:3000', false)).toBe('unknown');
    const up = vi.fn<typeof fetch>(async () => new Response(null));
    expect(await probeBp('http://localhost:3000', true, up)).toBe('up');
    expect(up).toHaveBeenCalledWith('http://localhost:3000', expect.objectContaining({ mode: 'no-cors' }));
    const refused = vi.fn<typeof fetch>(async () => { throw new TypeError('Failed to fetch'); });
    expect(await probeBp('http://localhost:3000', true, refused)).toBe('down');
  });
});
