import { describe, expect, it, vi } from 'vitest';
import {
  nextPageFromLink,
  repoPagePath,
  walkRepoPages,
  REPO_MAX_PAGES,
  type RepoPageResponse,
} from '../githubRepoPaging';

/**
 * Sweep #382 — the picker fetched ONE page of 100 and treated a failed
 * healthcheck as "no credential", so no PAT, a stale PAT and a truncated org
 * listing all rendered the same blank manual URL box.
 */

const page = (n: number, next: number | null, headerName: 'link' | 'Link' = 'link'): RepoPageResponse => ({
  status: 200,
  body: JSON.stringify([
    { full_name: `o/r${n}`, html_url: `https://github.com/o/r${n}`, description: null, private: false, updated_at: '' },
  ]),
  headers: next == null
    ? {}
    : { [headerName]: `<https://api.github.com/user/repos?page=${next}>; rel="next", <https://api.github.com/user/repos?page=9>; rel="last"` },
});

describe('nextPageFromLink', () => {
  it('reads the rel=next page number', () => {
    expect(nextPageFromLink(page(1, 2).headers)).toBe(2);
  });

  it('reads it whichever way the proxy cased the header', () => {
    expect(nextPageFromLink(page(1, 3, 'Link').headers)).toBe(3);
  });

  it('returns null with no Link header at all', () => {
    expect(nextPageFromLink({})).toBeNull();
  });

  it('returns null when only rel=last is offered', () => {
    expect(nextPageFromLink({ link: '<https://api.github.com/user/repos?page=9>; rel="last"' })).toBeNull();
  });
});

describe('walkRepoPages', () => {
  it('follows rel=next past the first page', async () => {
    const req = vi.fn(async (p: number) => (p < 3 ? page(p, p + 1) : page(p, null)));
    const walk = await walkRepoPages(req);
    expect(req).toHaveBeenCalledTimes(3);
    expect(walk.repos).toHaveLength(3);
    expect(walk.truncated).toBe(false);
  });

  it('stops at one page when GitHub offers no next', async () => {
    const req = vi.fn(async (p: number) => page(p, null));
    const walk = await walkRepoPages(req);
    expect(req).toHaveBeenCalledTimes(1);
    expect(walk.truncated).toBe(false);
  });

  it('reports truncation when the cap bites with more still offered', async () => {
    const req = vi.fn(async (p: number) => page(p, p + 1));
    const walk = await walkRepoPages(req);
    expect(req).toHaveBeenCalledTimes(REPO_MAX_PAGES);
    expect(walk.truncated).toBe(true);
  });

  it('stops on a non-200 rather than looping on an error body', async () => {
    const req = vi.fn(async (p: number) =>
      p === 1 ? page(1, 2) : ({ status: 401, body: '{}', headers: {} } as RepoPageResponse),
    );
    const walk = await walkRepoPages(req);
    expect(walk.repos).toHaveLength(1);
  });
});

describe('repoPagePath', () => {
  it('asks for the page it was given', () => {
    expect(repoPagePath(4)).toContain('page=4');
    expect(repoPagePath(1)).toContain('per_page=100');
  });
});
