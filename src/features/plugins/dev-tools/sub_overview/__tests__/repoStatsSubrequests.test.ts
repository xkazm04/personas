import { describe, it, expect, vi, beforeEach } from 'vitest';

// The repo vitals come from three requests per provider. Only the first one's
// status used to be checked; a failed PR/MR or commits request parsed its
// error body, found no array, and reported 0.

const executeApiRequest = vi.hoisted(() => vi.fn());
vi.mock('@/api/system/apiProxy', () => ({ executeApiRequest }));

import { fetchGitHubStats, fetchGitLabStats } from '../adapters';

type Res = { status: number; headers: Record<string, string>; body: string };
const ok = (body: unknown): Res => ({ status: 200, headers: {}, body: JSON.stringify(body) });
const fail = (status: number, message: string): Res => ({ status, headers: {}, body: JSON.stringify({ message }) });

function route(map: { repo: Res; pulls: Res; commits: Res }) {
  executeApiRequest.mockImplementation(async (_c: string, _m: string, path: string) => {
    if (path.includes('/pulls') || path.includes('/merge_requests')) return map.pulls;
    if (path.includes('/commits')) return map.commits;
    return map.repo;
  });
}

beforeEach(() => {
  executeApiRequest.mockReset();
});

describe('fetchGitHubStats sub-requests', () => {
  it('a rate-limited PR request fails the read instead of reporting 0 PRs and inflating issues', async () => {
    // open_issues_count includes PRs; with /pulls unread, "issues" would be 12.
    route({
      repo: ok({ open_issues_count: 12, default_branch: 'main', pushed_at: null }),
      pulls: fail(403, 'API rate limit exceeded'),
      commits: ok([{}, {}]),
    });
    await expect(fetchGitHubStats('cred', 'acme', 'app')).rejects.toThrow(/pulls request failed \(403\)/);
  });

  it('a failed commits request fails the read instead of a "0 commits this week" warning', async () => {
    route({
      repo: ok({ open_issues_count: 3, default_branch: 'main', pushed_at: null }),
      pulls: ok([{}]),
      commits: fail(500, 'Server Error'),
    });
    await expect(fetchGitHubStats('cred', 'acme', 'app')).rejects.toThrow(/commits request failed \(500\)/);
  });

  it('an empty repository (409 on commits) is a real zero', async () => {
    route({
      repo: ok({ open_issues_count: 1, default_branch: 'main', pushed_at: null }),
      pulls: ok([]),
      commits: fail(409, 'Git Repository is empty.'),
    });
    const s = await fetchGitHubStats('cred', 'acme', 'app');
    expect(s.commitsLastWeek).toBe(0);
    expect(s.openIssues).toBe(1);
  });
});

describe('fetchGitLabStats sub-requests', () => {
  it('a failed merge-request read fails the read instead of reporting 0 MRs', async () => {
    route({
      repo: ok({ open_issues_count: 4, default_branch: 'main', last_activity_at: null }),
      pulls: fail(401, '401 Unauthorized'),
      commits: ok([]),
    });
    await expect(fetchGitLabStats('cred', 'acme/app')).rejects.toThrow(/merge requests request failed \(401\)/);
  });
});
