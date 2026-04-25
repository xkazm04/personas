/**
 * Connector adapters — normalize GitHub / GitLab / Sentry API responses
 * into universal stat interfaces for the Project Overview tab.
 *
 * All adapters use `executeApiRequest` from the API proxy which handles
 * authentication, rate limiting, and SSRF protection.
 */

import { executeApiRequest } from '@/api/system/apiProxy';

// ---------------------------------------------------------------------------
// Universal stat types
// ---------------------------------------------------------------------------

export interface RepoStats {
  openIssues: number;
  openPullRequests: number;
  commitsLastWeek: number;
  defaultBranch: string;
  lastPushAt: string | null;
}

export interface MonitoringStats {
  unresolvedIssues: number;
  eventsLast24h: number;
  eventsLastWeek: number;
}

// ---------------------------------------------------------------------------
// Repo provider detection
// ---------------------------------------------------------------------------

export type RepoProvider = 'github' | 'gitlab';

export function detectRepoProvider(url: string): RepoProvider | null {
  if (url.includes('github.com')) return 'github';
  if (url.includes('gitlab.com') || url.includes('gitlab')) return 'gitlab';
  return null;
}

export function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  const match = url.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
  if (!match) return null;
  return { owner: match[1]!, repo: match[2]!.replace(/\.git$/, '') };
}

export function parseGitLabUrl(url: string): { path: string } | null {
  const match = url.match(/gitlab\.[^/]+\/(.+?)(?:\.git)?$/);
  if (!match) return null;
  return { path: match[1]! };
}

// ---------------------------------------------------------------------------
// GitHub adapter
// ---------------------------------------------------------------------------

export async function fetchGitHubStats(
  credentialId: string,
  owner: string,
  repo: string,
): Promise<RepoStats> {
  const headers = { Accept: 'application/vnd.github+json' };

  // 1. Repo metadata (open_issues_count includes PRs on GitHub)
  const repoRes = await executeApiRequest(
    credentialId,
    'GET',
    `/repos/${owner}/${repo}`,
    headers,
  );
  if (repoRes.status >= 400) {
    throw new Error(`GitHub repo request failed (${repoRes.status}): ${repoRes.body.slice(0, 200)}`);
  }
  const repoData = JSON.parse(repoRes.body);

  // 2. Open PRs count
  const prRes = await executeApiRequest(
    credentialId,
    'GET',
    `/repos/${owner}/${repo}/pulls?state=open&per_page=100`,
    headers,
  );
  const prData = JSON.parse(prRes.body);
  const openPrs = Array.isArray(prData) ? prData.length : 0;

  // 3. Commits last week
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const commitsRes = await executeApiRequest(
    credentialId,
    'GET',
    `/repos/${owner}/${repo}/commits?since=${weekAgo}&per_page=100`,
    headers,
  );
  const commitsData = JSON.parse(commitsRes.body);
  const commitsLastWeek = Array.isArray(commitsData) ? commitsData.length : 0;

  // GitHub open_issues_count includes PRs — subtract them for pure issue count
  const rawIssueCount = repoData.open_issues_count ?? 0;

  return {
    openIssues: Math.max(0, rawIssueCount - openPrs),
    openPullRequests: openPrs,
    commitsLastWeek,
    defaultBranch: repoData.default_branch ?? 'main',
    lastPushAt: repoData.pushed_at ?? null,
  };
}

// ---------------------------------------------------------------------------
// GitLab adapter
// ---------------------------------------------------------------------------

export async function fetchGitLabStats(
  credentialId: string,
  projectPath: string,
): Promise<RepoStats> {
  const encoded = encodeURIComponent(projectPath);
  const headers = {};

  // 1. Project metadata
  const projRes = await executeApiRequest(
    credentialId,
    'GET',
    `/api/v4/projects/${encoded}?statistics=true`,
    headers,
  );
  if (projRes.status >= 400) {
    throw new Error(`GitLab project request failed (${projRes.status}): ${projRes.body.slice(0, 200)}`);
  }
  const projData = JSON.parse(projRes.body);

  // 2. Open MRs
  const mrRes = await executeApiRequest(
    credentialId,
    'GET',
    `/api/v4/projects/${encoded}/merge_requests?state=opened&per_page=100`,
    headers,
  );
  const mrData = JSON.parse(mrRes.body);
  const openMRs = Array.isArray(mrData) ? mrData.length : 0;

  // 3. Commits last week
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const commitsRes = await executeApiRequest(
    credentialId,
    'GET',
    `/api/v4/projects/${encoded}/repository/commits?since=${weekAgo}&per_page=100`,
    headers,
  );
  const commitsData = JSON.parse(commitsRes.body);
  const commitsLastWeek = Array.isArray(commitsData) ? commitsData.length : 0;

  return {
    openIssues: projData.open_issues_count ?? 0,
    openPullRequests: openMRs,
    commitsLastWeek,
    defaultBranch: projData.default_branch ?? 'main',
    lastPushAt: projData.last_activity_at ?? null,
  };
}

// ---------------------------------------------------------------------------
// Sentry adapter
// ---------------------------------------------------------------------------

export interface SentryOrg {
  slug: string;
  name: string;
}

export interface SentryProject {
  slug: string;
  name: string;
  platform: string | null;
}

/** Lists organizations the credential's auth token has access to. */
export async function fetchSentryOrgs(credentialId: string): Promise<SentryOrg[]> {
  const res = await executeApiRequest(credentialId, 'GET', '/api/0/organizations/', {});
  if (res.status >= 400) {
    throw new Error(`Sentry orgs request failed (${res.status}): ${res.body.slice(0, 200)}`);
  }
  const data = JSON.parse(res.body);
  if (!Array.isArray(data)) return [];
  return data.map((o: { slug: string; name: string }) => ({ slug: o.slug, name: o.name }));
}

/** Lists projects in an organization. */
export async function fetchSentryProjects(
  credentialId: string,
  orgSlug: string,
): Promise<SentryProject[]> {
  const res = await executeApiRequest(
    credentialId,
    'GET',
    `/api/0/organizations/${orgSlug}/projects/`,
    {},
  );
  if (res.status >= 400) {
    throw new Error(`Sentry projects request failed (${res.status}): ${res.body.slice(0, 200)}`);
  }
  const data = JSON.parse(res.body);
  if (!Array.isArray(data)) return [];
  return data.map((p: { slug: string; name: string; platform: string | null }) => ({
    slug: p.slug,
    name: p.name,
    platform: p.platform,
  }));
}

/**
 * Splits the persisted slug into `[orgSlug, projectSlug]`.
 * The project's `monitoring_project_slug` column holds `org/project` so we
 * avoid an extra DB column for the org. Pre-existing single-slug entries are
 * tolerated by returning `[null, slug]` and letting the caller fall back.
 */
export function splitSentrySlug(combined: string | null | undefined): [string | null, string | null] {
  if (!combined) return [null, null];
  const idx = combined.indexOf('/');
  if (idx === -1) return [null, combined];
  return [combined.slice(0, idx), combined.slice(idx + 1)];
}

export async function fetchSentryStats(
  credentialId: string,
  orgSlug: string,
  projectSlug: string,
): Promise<MonitoringStats> {
  const headers = {};

  // 1. Unresolved issues count
  const issuesRes = await executeApiRequest(
    credentialId,
    'GET',
    `/api/0/projects/${orgSlug}/${projectSlug}/issues/?query=is:unresolved&limit=1`,
    headers,
  );
  if (issuesRes.status >= 400) {
    throw new Error(`Sentry issues request failed (${issuesRes.status}): ${issuesRes.body.slice(0, 200)}`);
  }
  // Sentry returns total in X-Hits header or we count items
  const totalHeader = issuesRes.headers['x-hits'] ?? issuesRes.headers['X-Hits'];
  const unresolvedIssues = totalHeader ? parseInt(totalHeader, 10) : 0;

  // 2. Events stats (24h + 7d)
  const now = Math.floor(Date.now() / 1000);
  const day = now - 86400;
  const week = now - 7 * 86400;

  let eventsLast24h = 0;
  let eventsLastWeek = 0;

  try {
    const statsRes = await executeApiRequest(
      credentialId,
      'GET',
      `/api/0/projects/${orgSlug}/${projectSlug}/stats/?stat=received&since=${week}&until=${now}&resolution=1d`,
      headers,
    );
    const statsData = JSON.parse(statsRes.body);
    if (Array.isArray(statsData)) {
      eventsLastWeek = statsData.reduce((sum: number, [, count]: [number, number]) => sum + count, 0);
      // Last bucket is last 24h
      if (statsData.length > 0) {
        const lastBuckets = statsData.filter(([ts]: [number, number]) => ts >= day);
        eventsLast24h = lastBuckets.reduce((sum: number, [, count]: [number, number]) => sum + count, 0);
      }
    }
  } catch {
    // Stats endpoint may not be available on all Sentry plans
  }

  return {
    unresolvedIssues,
    eventsLast24h,
    eventsLastWeek,
  };
}
