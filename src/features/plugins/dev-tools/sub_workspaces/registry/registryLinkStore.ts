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
import { setKnowledgeRegistryRoot } from '@/api/devTools/devTools';
import { silentCatch } from '@/lib/silentCatch';

/** The lanes a registry can publish. Presence is what pairing reports.
 *  Mirrors the lane list in the registry's own root `registry.yaml` — `usage`
 *  was added there and omitted here, so pairing reported four lanes for a repo
 *  that publishes five. */
export const LANES = ['knowledge', 'skills', 'practices', 'memory', 'usage'] as const;
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
  /**
    * Absolute path of the local clone — CHOSEN by the operator, not derived.
    *
    * A registry is two things at once: a GitHub repo (the remote everyone shares)
    * and a working copy on this machine. Only the pair is usable: a scan skill has
    * to read the clone and the project repos side by side, and it cannot do that
    * against a URL. So the path is captured at wiring time rather than invented,
    * which also lets an existing clone be adopted instead of duplicated.
    *
    * One per registry, never per workspace.
    */
  clonePath: string;
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

/**
 * Mirror the knowledge-lane clone path into `app_settings` for the RUNNER.
 *
 * This store is localStorage, which the Rust side cannot read — and the consult
 * lane (`engine::knowledge_consult`) runs inside executions that have no
 * frontend at all: a schedule firing at 3am has no window to ask. So one scalar
 * crosses the boundary, and only one: the path.
 *
 * Done in `commit` rather than in each mutator so it cannot drift — every
 * mutation goes through here, so there is no path that changes the wiring
 * without updating what the backend reads. And it goes through a COMMAND rather
 * than a settings write, so the key's name is spelled once, in Rust: a name
 * mirrored in two languages with only a comment holding it together is a name
 * that drifts, and this one drifting means executions consult a registry the
 * operator thinks they unwired.
 *
 * **One root, deliberately, for now.** A registry can be held by several
 * workspaces while an execution belongs to a project, so there is no per-run
 * mapping to consult yet; the knowledge-lane holder with the lowest id wins,
 * which is at least stable rather than order-of-insertion. Per-project
 * knowledge roots are the next slice, and this is the seam they replace.
 */
function syncKnowledgeRootSetting(next: Snapshot): void {
  const holder = Object.values(next.registries)
    .filter((r) => r.lanes.includes('knowledge') && r.clonePath.trim())
    .sort((a, b) => a.id.localeCompare(b.id))[0];
  const write = setKnowledgeRegistryRoot(holder ? holder.clonePath : null);
  // Best-effort: a failed mirror means the consult lane stays off, which is the
  // same state as no registry — degraded, never broken. Reported because a
  // silent failure here looks exactly like "the registry has nothing to say".
  void write.catch(silentCatch('registryLinkStore:knowledgeRoot'));
}

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
  syncKnowledgeRootSetting(next);
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
  clonePath: string,
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
    clonePath,
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

/**
 * Wire an already-existing LOCAL working copy to a workspace (plan D1: the
 * local checkout IS the registry). No credential, no pairing session, no
 * clone step — the folder was probed (`dev_tools_registry_probe`) and found
 * to carry a `registry.yaml`, so the link lands directly in state `paired`
 * with the lanes/domains/sha the probe read.
 *
 * A separate function rather than a `linkRegistry` variant on purpose: that
 * signature is the GitHub path's contract (credential + repo + later pairing
 * dispatch) and other sessions own it; a credential-less local link is a
 * different act, not a parameter default.
 *
 * Identity: the catalog's `fullName` when the folder carries one (so linking
 * the local checkout of a repo another workspace paired via GitHub resolves
 * to the SAME registry), else the registry.yaml `name`, else the folder path.
 */
export function linkLocalRegistry(
  workspaceId: string,
  folderPath: string,
  probe: {
    name: string | null;
    fullName: string | null;
    lanes: string[];
    domains: string[];
    headSha: string | null;
  },
): Registry {
  const s = registryLinkSnapshot();
  const path = folderPath.trim();
  const id = probe.fullName ?? probe.name ?? path;
  const existing = s.registries[id];

  const registry: Registry = {
    ...(existing ?? {
      id,
      fullName: probe.fullName ?? probe.name ?? path,
      url: probe.fullName ? `https://github.com/${probe.fullName}` : '',
      defaultBranch: 'main',
      credentialId: '',
      clonePath: path,
      state: 'unlinked',
      sessionId: null,
      lanes: [],
      domains: [],
      sha: null,
      pairedAt: null,
      error: null,
    }),
    clonePath: path,
    state: 'paired',
    // The probe reports whatever lanes the registry declares; the store's
    // vocabulary is the LANES it understands, so unknown lanes are dropped
    // rather than smuggled into a union type they are not part of.
    lanes: probe.lanes.filter((l): l is Lane => (LANES as readonly string[]).includes(l)),
    domains: probe.domains,
    sha: probe.headSha,
    pairedAt: new Date().toISOString(),
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
export function pairingBrief(registry: Registry): string {
  const clonePath = registry.clonePath;
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
export async function dispatchPairing(registry: Registry, cwd: string): Promise<void> {
  patchRegistry(registry.id, { state: 'pairing', error: null });
  try {
    const session = await spawnSession(cwd, ['-p', pairingBrief(registry)]);
    const sessionId = typeof session === 'string' ? session : ((session as { id?: string })?.id ?? null);
    patchRegistry(registry.id, { sessionId });
  } catch (e) {
    patchRegistry(registry.id, {
      state: 'error',
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
