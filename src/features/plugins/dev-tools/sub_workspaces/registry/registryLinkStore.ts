// Workspace ↔ knowledge-registry wiring — the shape and the local store.
//
// ## The model, and why it is not one-per-workspace
//
// A registry is a REPO, not a workspace's property. The operator's constraint —
// "one registry can be wired to multiple workspaces, if the user clicks it in
// both" — makes the cardinality **1 registry : N workspaces**, so registries are
// their own keyed collection and a workspace holds a reference:
//
//     registries        : Record<registryId, Registry>   // keyed by owner/repo
//     workspaceRegistry : Record<workspaceId, registryId>
//
// Modelling it the other way (a `registry` field on Workspace) would clone the
// same repo once per workspace, pair it twice, and give two workspaces two
// drifting opinions of one remote. Keying by `owner/repo` means picking the same
// repo in a second workspace resolves to the SAME entity — one clone, one
// pairing, one SHA — which is the property the constraint is really asking for.
//
// ## Why local storage, and for how long
//
// `dev_workspaces` itself started here: the migration that created it says it
// "promotes the sub_workspaces localStorage prototype to SQLite". This is the
// same move at the same stage, deliberately — the shape is what needs settling
// first, and a schema migration for a shape nobody has looked at yet is the
// expensive half. When the shape holds, it promotes to a table and the store
// keeps its signature.
//
// ## What pairing does NOT do
//
// Pairing establishes the LINK: verify the repo carries a root `registry.yaml`,
// read which lanes it publishes, write this app's consumer overlay, and report
// the inventory. It deliberately stops short of syncing skills or extracting the
// knowledge base — that mechanism is an open question the operator is weighing
// variants on, and wiring it in here by implication would settle it by accident.

import { spawnSession } from '@/api/fleet/fleet';
import { silentCatch } from '@/lib/silentCatch';

/** The four lanes a registry can publish. Presence is what pairing reports. */
export const LANES = ['knowledge', 'skills', 'practices', 'memory'] as const;
export type Lane = (typeof LANES)[number];

export type PairingState =
  /** No registry chosen for this workspace yet. */
  | 'unlinked'
  /** A Fleet session is establishing the link. */
  | 'pairing'
  /** Linked, lanes known. */
  | 'paired'
  /** The last pairing attempt failed; `error` says what happened. */
  | 'error';

export interface Registry {
  /** `owner/repo` — also the identity. Picking the same repo twice is one registry. */
  id: string;
  fullName: string;
  url: string;
  defaultBranch: string;
  /** Vault credential the repo was picked with; pairing and later pulls reuse it. */
  credentialId: string;
  /** Absolute path of the local clone. One per registry, never per workspace. */
  clonePath: string | null;
  state: PairingState;
  /** Fleet session that ran (or is running) the pairing brief. */
  sessionId: string | null;
  /** Lanes the registry actually publishes, discovered by pairing. */
  lanes: Lane[];
  /** Bundle domains under `knowledge/`, discovered by pairing. */
  domains: string[];
  /** Commit the local clone is pinned at. */
  sha: string | null;
  pairedAt: string | null;
  error: string | null;
}

interface Snapshot {
  registries: Record<string, Registry>;
  workspaceRegistry: Record<string, string>;
}

const KEY = 'devtools.registryLinks.v1';

const EMPTY: Snapshot = { registries: {}, workspaceRegistry: {} };

function read(): Snapshot {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<Snapshot>;
    return {
      registries: parsed.registries ?? {},
      workspaceRegistry: parsed.workspaceRegistry ?? {},
    };
  } catch (e) {
    // A corrupt blob must not take the workspace panel down with it. Losing a
    // prototype's link table is recoverable in two clicks; a crashing Atlas is not.
    // Still reported: a parse failure here means someone's wiring silently vanished,
    // and the breadcrumb is the only trace that would explain it.
    silentCatch('registryLinkStore:read')(e);
    return EMPTY;
  }
}

let snapshot: Snapshot = EMPTY;
let loaded = false;
const listeners = new Set<() => void>();

function commit(next: Snapshot): void {
  snapshot = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch (e) {
    // Quota or private-mode failure: the in-memory value still updates, so the
    // session keeps working and only persistence is lost — but "your wiring will
    // be gone next launch" is exactly the kind of failure that must not be silent.
    silentCatch('registryLinkStore:persist')(e);
  }
  listeners.forEach((l) => l());
}

export function subscribeRegistryLinks(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function registryLinkSnapshot(): Snapshot {
  if (!loaded) {
    snapshot = read();
    loaded = true;
  }
  return snapshot;
}

/** The registry wired to a workspace, or null. */
export function registryFor(workspaceId: string): Registry | null {
  const s = registryLinkSnapshot();
  const id = s.workspaceRegistry[workspaceId];
  return id ? (s.registries[id] ?? null) : null;
}

/**
 * Every workspace wired to a registry. This is the multi-workspace fact made
 * queryable — a UI that cannot show it will let someone "disconnect" a registry
 * three other workspaces are reading.
 */
export function workspacesOn(registryId: string): string[] {
  const s = registryLinkSnapshot();
  return Object.entries(s.workspaceRegistry)
    .filter(([, rid]) => rid === registryId)
    .map(([wsId]) => wsId)
    .sort();
}

/**
 * Wire a repo to a workspace. Returns the registry — EXISTING one if this repo
 * is already wired elsewhere, so a second workspace joins rather than forks.
 */
export function linkRegistry(
  workspaceId: string,
  repo: { fullName: string; defaultBranch: string },
  credentialId: string,
): Registry {
  const s = registryLinkSnapshot();
  const id = repo.fullName;
  const existing = s.registries[id];

  const registry: Registry = existing ?? {
    id,
    fullName: repo.fullName,
    url: `https://github.com/${repo.fullName}`,
    defaultBranch: repo.defaultBranch,
    credentialId,
    clonePath: null,
    state: 'unlinked',
    sessionId: null,
    lanes: [],
    domains: [],
    sha: null,
    pairedAt: null,
    error: null,
  };

  commit({
    registries: { ...s.registries, [id]: registry },
    workspaceRegistry: { ...s.workspaceRegistry, [workspaceId]: id },
  });
  return registry;
}

/** Detach a workspace. The registry survives while any other workspace holds it. */
export function unlinkRegistry(workspaceId: string): void {
  const s = registryLinkSnapshot();
  const id = s.workspaceRegistry[workspaceId];
  if (!id) return;

  const workspaceRegistry = { ...s.workspaceRegistry };
  delete workspaceRegistry[workspaceId];

  const stillHeld = Object.values(workspaceRegistry).includes(id);
  const registries = { ...s.registries };
  if (!stillHeld) delete registries[id];

  commit({ registries, workspaceRegistry });
}

export function patchRegistry(id: string, patch: Partial<Registry>): void {
  const s = registryLinkSnapshot();
  const current = s.registries[id];
  if (!current) return;
  commit({ ...s, registries: { ...s.registries, [id]: { ...current, ...patch } } });
}

/**
 * The pairing brief. Written here rather than inline at a call site because it
 * is the contract between this UI and whatever agent runs it — and because its
 * LAST paragraph is a boundary, not a nicety: the sync/extraction mechanism is
 * still an open design question, and an agent told to "set up the registry"
 * without that line will helpfully invent one.
 */
export function pairingBrief(registry: Registry, clonePath: string): string {
  return [
    `Pair this machine with the knowledge registry ${registry.fullName}.`,
    '',
    `1. Clone ${registry.url} (branch ${registry.defaultBranch}) to ${clonePath} if it is not already there; otherwise fetch and report the current commit.`,
    '2. Verify it carries a root `registry.yaml`. That file is the vendor-neutral authority declaring the repo\'s lanes. If it is missing, STOP and report — do not scaffold one without being asked.',
    '3. Read which of the four lanes (knowledge, skills, practices, memory) actually carry content, and list the bundle domains under `knowledge/<domain>/`.',
    '4. Write this app\'s consumer overlay at `.personas/registry.yaml` beside any existing `.ascent/registry.yaml`. Do NOT modify another consumer\'s overlay or the root `registry.yaml` — a second consumer adds its own file, it does not rewrite the first.',
    '5. Report: the commit SHA, the lanes found, the domains found, and anything that looked wrong.',
    '',
    'Do NOT sync skills into this machine and do NOT extract or ingest the knowledge base. Establishing the link is the whole task; the initial-sync mechanism is still being designed and must not be improvised here.',
  ].join('\n');
}

/**
 * Dispatch the pairing task to Fleet.
 *
 * `cwd` is a real directory the session can start in — the workspace's first
 * member project. The registry clone does not exist yet, so it cannot be the
 * cwd of the session that creates it.
 */
export async function dispatchPairing(registry: Registry, cwd: string, clonePath: string): Promise<void> {
  patchRegistry(registry.id, { state: 'pairing', error: null, clonePath });
  try {
    const session = await spawnSession(cwd, ['-p', pairingBrief(registry, clonePath)]);
    const sessionId = typeof session === 'string' ? session : ((session as { id?: string })?.id ?? null);
    patchRegistry(registry.id, { sessionId });
  } catch (e) {
    patchRegistry(registry.id, {
      state: 'error',
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
