/**
 * releaseComposition - what the Release card and its read-only sheet show
 * (spark one-control, WP3): the version, the items, the notes.
 *
 * bp composes and finishes releases; Personas only READS the composition, so
 * this is a pure function over the store snapshot:
 *
 *  - A release that waits on the operator (its PR is open, or it merged and
 *    was never finished) is shown as it stands: its version, its items
 *    (`compare.ts releaseItems`), its notes.
 *  - Otherwise the next release is suggested from the accepted items no
 *    release holds (`compare.ts unreleased`) by bp's own rule
 *    (`release.ts suggestVersion`).
 *
 * The one input bp has that Personas does not: git tags. bp suggests from the
 * latest `v*` tag; no door reads a repo's tags here, so the store's own
 * releases stand in for them (each is cut as `v<version>`), newest by semver
 * first, and every release not yet tagged is `taken`, as bp passes it. A
 * store with no release suggests what bp suggests with no tag and no
 * manifest: 0.1.0.
 *
 * React-free and store-free.
 */
import { releaseItems, unreleased } from '@/lib/lensScan/compare';
import { bumpOf, isVersion, suggestVersion } from '@/lib/lensScan/release';
import type { Proposal, Release, ScanSnapshot } from '@/lib/lensScan/wire';

/** Release statuses that wait on the operator. */
export const RELEASE_WAITS: ReadonlySet<string> = new Set(['pr-open', 'merged']);

export interface ReleaseComposition {
  version: string;
  /** What a suggestion was bumped from (`v0.4.0`), or null (an open release, or none to bump from). */
  from: string | null;
  /** The bump a suggestion took; null for an open release or a first version. */
  bump: 'minor' | 'patch' | null;
  /** The release's items, or the accepted items waiting for one. */
  items: Proposal[];
  /** Markdown notes, when the release has them. */
  notes: string | null;
  /** The newest release not yet tagged, if any (it may be still building). */
  open: Pick<Release, 'id' | 'version' | 'status' | 'pr_url'> | null;
  /** The open release waits on the operator: it is what the sheet shows. */
  waiting: boolean;
  /** Accepted items no release holds (counted even while an open release is shown). */
  unreleasedCount: number;
}

function semverParts(v: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Newest first; a version that is not semver sorts last. */
function compareSemverDesc(a: string, b: string): number {
  const pa = semverParts(a);
  const pb = semverParts(b);
  if (!pa || !pb) return pa ? -1 : pb ? 1 : 0;
  for (let i = 0; i < 3; i += 1) if (pa[i] !== pb[i]) return pb[i]! - pa[i]!;
  return 0;
}

/** The store's releases as bp's tag list (`v<version>`, newest first). */
export function tagsFromReleases(releases: readonly Release[]): string[] {
  return releases
    .map((r) => r.version)
    .filter(isVersion)
    .sort(compareSemverDesc)
    .map((v) => `v${v}`);
}

/** The newest release that is not tagged yet, if any. */
export function openReleaseOf(releases: readonly Release[]): Release | null {
  const open = releases.filter((r) => r.status !== 'tagged');
  return open.sort((a, b) => compareSemverDesc(a.version, b.version))[0] ?? null;
}

export function composeRelease(scan: Pick<ScanSnapshot, 'proposals' | 'releases'>): ReleaseComposition {
  const waitingItems = unreleased(scan);
  const open = openReleaseOf(scan.releases);
  const openView = open ? { id: open.id, version: open.version, status: open.status, pr_url: open.pr_url } : null;
  if (open && RELEASE_WAITS.has(open.status)) {
    return {
      version: open.version,
      from: null,
      bump: null,
      items: releaseItems(scan, open.id),
      notes: open.notes?.trim() ? open.notes : null,
      open: openView,
      waiting: true,
      unreleasedCount: waitingItems.length,
    };
  }
  const tags = tagsFromReleases(scan.releases);
  const taken = new Set(scan.releases.filter((r) => r.status !== 'tagged').map((r) => r.version));
  const s = suggestVersion(tags, undefined, waitingItems, taken);
  const fromTag = tags.length > 0 && s.from !== 'none';
  return {
    version: s.version,
    from: fromTag ? s.from : null,
    bump: fromTag ? bumpOf(waitingItems) : null,
    items: waitingItems,
    notes: null,
    open: openView,
    waiting: false,
    unreleasedCount: waitingItems.length,
  };
}

/** The version an open release carries in its id (`rel-<version>`), readable without a snapshot. */
export function versionOfReleaseId(id: string): string | null {
  const v = id.startsWith('rel-') ? id.slice(4) : '';
  return isVersion(v) ? v : null;
}
