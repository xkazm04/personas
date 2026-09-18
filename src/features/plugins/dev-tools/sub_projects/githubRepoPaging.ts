// Repo-listing mechanics for `GitHubRepoSelector`, kept out of the component so
// the three credential outcomes and the Link-header walk can be gated without
// rendering anything.
//
// The picker used to fetch ONE page of 100 and treat a failed healthcheck as
// "no credential", so three different situations collapsed into the same blank
// manual URL box: no PAT, a stale PAT, and an org with more repos than the page
// held. The operator could not tell which one they were in.

/** Repos the walk will fetch at most. 5 x 100 mirrors the LLM adapters' cap. */
export const REPO_MAX_PAGES = 5;
export const REPO_PAGE_SIZE = 100;

export interface GitHubRepo {
  full_name: string;
  html_url: string;
  description: string | null;
  private: boolean;
  updated_at: string;
}

/** What the picker knows about the GitHub connector it was asked to use. */
export type RepoCredState =
  /** No GitHub PAT in the vault at all. Manual URL is the honest fallback. */
  | 'none'
  /** A PAT exists but failed its healthcheck. NOT the same as having none. */
  | 'unhealthy'
  /** Listed. */
  | 'ready';

export interface RepoPageResponse {
  status: number;
  body: string;
  headers: { [key in string]?: string };
}

/**
 * The next page number from a GitHub `Link` header, or null when there is none.
 *
 * GitHub's own pagination signal; guessing from a full page instead would keep
 * requesting after the last one on an org whose repo count is a multiple of the
 * page size.
 */
export function nextPageFromLink(headers: { [key in string]?: string }): number | null {
  // Header names are case-preserved by the proxy, so look both ways rather than
  // silently paginating only when the server happened to capitalise it.
  const link = headers['link'] ?? headers['Link'];
  if (!link) return null;
  for (const part of link.split(',')) {
    if (!/rel="?next"?/.test(part)) continue;
    const url = /<([^>]+)>/.exec(part)?.[1];
    if (!url) continue;
    const page = /[?&]page=(\d+)/.exec(url)?.[1];
    if (page) return Number(page);
  }
  return null;
}

export interface RepoWalk {
  repos: GitHubRepo[];
  /** The cap stopped the walk while GitHub still offered a next page. */
  truncated: boolean;
}

/**
 * Walk `/user/repos` until GitHub stops offering a next page or the cap bites.
 *
 * @param request issues one page; injected so the walk is testable without IPC.
 */
export async function walkRepoPages(
  request: (page: number) => Promise<RepoPageResponse>,
): Promise<RepoWalk> {
  const repos: GitHubRepo[] = [];
  let page = 1;
  for (let i = 0; i < REPO_MAX_PAGES; i++) {
    const res = await request(page);
    if (res.status !== 200) break;
    const parsed = JSON.parse(res.body) as unknown;
    if (!Array.isArray(parsed)) break;
    repos.push(...(parsed as GitHubRepo[]));
    const next = nextPageFromLink(res.headers);
    if (next == null) return { repos, truncated: false };
    page = next;
  }
  // Left the loop with GitHub still offering more: the list is a floor.
  return { repos, truncated: true };
}

/** The request path for one page of the authenticated user's repositories. */
export function repoPagePath(page: number): string {
  return `/user/repos?per_page=${REPO_PAGE_SIZE}&page=${page}&sort=updated&affiliation=owner,collaborator,organization_member`;
}
