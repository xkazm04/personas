/**
 * Connector adapters — normalize GitHub / GitLab / Sentry API responses
 * into universal stat interfaces for the Project Overview tab.
 *
 * All adapters use `executeApiRequest` from the API proxy which handles
 * authentication, rate limiting, and SSRF protection.
 */

import { executeApiRequest } from '@/api/system/apiProxy';
import { silentCatch } from '@/lib/silentCatch';


// ---------------------------------------------------------------------------
// Universal stat types
// ---------------------------------------------------------------------------

export interface RepoStats {
  openIssues: number;
  openPullRequests: number;
  commitsLastWeek: number;
  defaultBranch: string;
  lastPushAt: string | null;
  /**
   * True when a value below was derived from a single `per_page=100` page
   * that came back full — the true count is >= the reported number, not
   * exact. (A page-length fetch can't distinguish "exactly 100" from
   * "1000+"; callers should render e.g. "100+" rather than treating these
   * as precise.) `openIssues` is also marked capped when `openPullRequests`
   * is, since GitHub derives it by subtracting the (possibly capped) PR count.
   */
  openPullRequestsCapped?: boolean;
  commitsLastWeekCapped?: boolean;
  openIssuesCapped?: boolean;
}

export interface MonitoringStats {
  /** `null` when Sentry's count couldn't be determined (missing X-Hits header
   * on every attempt) — render as "—", not "0", so a project with real
   * unresolved errors doesn't read as healthy. */
  unresolvedIssues: number | null;
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
  // GitHub rejects requests without a User-Agent header (403 "Request forbidden
  // by administrative rules"). The healthcheck connector already uses
  // 'personas-desktop' — match it here so the same rules apply.
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'personas-desktop',
  };

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
  // A full page (exactly per_page items) means there may be more beyond it —
  // a single `?per_page=100` page length is not a reliable total.
  const openPrsCapped = openPrs === 100;

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
  const commitsLastWeekCapped = commitsLastWeek === 100;

  // GitHub open_issues_count includes PRs — subtract them for pure issue count
  const rawIssueCount = repoData.open_issues_count ?? 0;

  return {
    openIssues: Math.max(0, rawIssueCount - openPrs),
    openPullRequests: openPrs,
    commitsLastWeek,
    defaultBranch: repoData.default_branch ?? 'main',
    lastPushAt: repoData.pushed_at ?? null,
    openPullRequestsCapped: openPrsCapped,
    commitsLastWeekCapped,
    // The derived issue count also becomes unreliable once the PR count it
    // subtracts is itself a lower bound.
    openIssuesCapped: openPrsCapped,
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
    openPullRequestsCapped: openMRs === 100,
    commitsLastWeekCapped: commitsLastWeek === 100,
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

/** One unresolved Sentry issue. `culprit` is Sentry's guess at the code location —
 *  often a file path, which is what lets a crash be matched onto a context. */
export interface SentryUnresolvedIssue {
  id: string;
  shortId: string;
  title: string;
  culprit: string | null;
  count: number;
  lastSeen: string | null;
}

/**
 * The project's loudest unresolved issues (docs/plans/dev-findings-loop.md 1A-ii).
 * `fetchSentryStats` only returns COUNTS; the findings sweep and the context-map
 * error chips need the issues themselves. Sorted by event count, worst first.
 */
export async function fetchSentryUnresolvedIssues(
  credentialId: string,
  orgSlug: string,
  projectSlug: string,
  limit = 25,
): Promise<SentryUnresolvedIssue[]> {
  const res = await executeApiRequest(
    credentialId,
    'GET',
    `/api/0/projects/${orgSlug}/${projectSlug}/issues/?query=is:unresolved&statsPeriod=14d&limit=${limit}`,
    {},
  );
  if (res.status >= 400) {
    throw new Error(`Sentry issues request failed (${res.status}): ${res.body.slice(0, 200)}`);
  }
  const parsed: unknown = JSON.parse(res.body);
  if (!Array.isArray(parsed)) return [];
  return (parsed as Record<string, unknown>[])
    .map((i) => ({
      id: String(i.id ?? ''),
      shortId: String(i.shortId ?? i.id ?? ''),
      title: String(i.title ?? 'Unknown issue'),
      culprit: typeof i.culprit === 'string' && i.culprit ? i.culprit : null,
      // Sentry returns `count` as a string.
      count: Number(i.count ?? 0) || 0,
      lastSeen: typeof i.lastSeen === 'string' ? i.lastSeen : null,
    }))
    .filter((i) => i.shortId)
    .sort((a, b) => b.count - a.count);
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
  // Sentry returns the total in the X-Hits header (limit=1 keeps the body
  // cheap, so there's no item array to fall back to counting). Some
  // deployments/proxies strip or rename the header — in that case don't
  // silently report 0 (which would render as "healthy"/green); report
  // `null` so the caller can show "—" instead.
  const totalHeader = issuesRes.headers['x-hits'] ?? issuesRes.headers['X-Hits'];
  const parsedTotal = totalHeader ? parseInt(totalHeader, 10) : NaN;
  const unresolvedIssues = Number.isFinite(parsedTotal) ? parsedTotal : null;

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
  } catch (err) { silentCatch("features/plugins/dev-tools/sub_overview/adapters:catch1")(err); }

  return {
    unresolvedIssues,
    eventsLast24h,
    eventsLastWeek,
  };
}
