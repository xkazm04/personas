// Workspace ↔ knowledge-registry wiring — the shape, and the view over the
// table that now holds it.
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
// ## Where it lives now
//
// In SQLite, as of migration e47 — `dev_registries` + `dev_workspace_registries`.
// It started in `localStorage` for the reason `dev_workspaces` itself did: the
// shape is the expensive half and a schema for a shape nobody has looked at yet
// is the wrong bet. The shape held, so it promoted, and the store kept its
// signature. What that bought is not tidiness: every gate a registry feeds —
// Curator's eligibility, her loop, her dispatch — is in Rust, and Rust could not
// read a word of the blob. One derived scalar used to cross the boundary
// (`app_settings.knowledge_registry_root`, computed HERE in TypeScript); the
// rule that computes it now lives in `repos::dev_registries::knowledge_root`
// beside the rows it reads, and arrives on the snapshot as `knowledgeRoot`.
//
// This module is therefore a VIEW: an in-memory copy of the table, loaded once,
// re-read after every mutation. `subscribeRegistryLinks` / `registryLinkSnapshot`
// keep their exact signatures, because six `useSyncExternalStore` consumers are
// built on them. The mutators are now async — that is the whole breakage
// surface, and it is what a write that has to reach a database looks like.
//
// ## What pairing does NOT do
//
// Pairing establishes the LINK: verify the repo carries a root `registry.yaml`,
// read which lanes it publishes, write this app's consumer overlay, and report
// the inventory. It deliberately stops short of syncing skills or extracting the
// knowledge base — that mechanism is an open question the operator is weighing
// variants on, and wiring it in here by implication would settle it by accident.

import { spawnSession } from '@/api/fleet/fleet';
import {
  importRegistryLinks,
  linkRegistryToWorkspace,
  registrySnapshot,
  unlinkRegistryFromWorkspace,
  upsertRegistry,
} from '@/api/devTools/registries';
import type { DevRegistry } from '@/lib/bindings/DevRegistry';
import type { DevRegistryInput } from '@/lib/bindings/DevRegistryInput';
import type { RegistryLinkSnapshot } from '@/lib/bindings/RegistryLinkSnapshot';
import type { WorkspaceRegistryLink } from '@/lib/bindings/WorkspaceRegistryLink';
import { silentCatch } from '@/lib/silentCatch';

/** The lanes a registry can publish. Presence is what pairing reports.
 *  Mirrors the lane list in the registry's own root `registry.yaml` — `usage`
 *  was added there and omitted here, so pairing reported four lanes for a repo
 *  that publishes five. */
export const LANES = ['knowledge', 'skills', 'practices', 'memory', 'usage'] as const;
export type Lane = (typeof LANES)[number];

/**
 * Where a registry's pairing stands. The set is the backend's
 * (`RegistryPairingState`, which mirrors the table CHECK) rather than a second
 * spelling of it here: a closed set written twice is a closed set that drifts.
 */
export type PairingState = DevRegistry['state'];

/**
 * A registry, as the backend stores it. Re-exported under the name six
 * surfaces already import, so promoting the store to a table did not rename a
 * type across them.
 */
export type Registry = DevRegistry;

interface Snapshot {
  registries: Record<string, Registry>;
  workspaceRegistry: Record<string, string>;
  /**
   * The knowledge-lane clone path the RUNNER consults, decided by Rust. Carried
   * on the snapshot rather than re-derived here — `useRegistryRoot` had its own
   * copy of the rule, and two copies of a pick mean two surfaces can name two
   * different corpora for one wiring.
   */
  knowledgeRoot: string | null;
}

/**
 * The retired browser blob. Still READ once, by `adoptLocalBlob` below, and
 * never written.
 */
const KEY = 'devtools.registryLinks.v1';

const EMPTY: Snapshot = { registries: {}, workspaceRegistry: {}, knowledgeRoot: null };

let snapshot: Snapshot = EMPTY;
let loadStarted = false;
const listeners = new Set<() => void>();

function publish(next: RegistryLinkSnapshot): void {
  const registries: Record<string, Registry> = {};
  for (const r of next.registries) registries[r.id] = r;
  const workspaceRegistry: Record<string, string> = {};
  for (const l of next.links) workspaceRegistry[l.workspaceId] = l.registryId;
  snapshot = { registries, workspaceRegistry, knowledgeRoot: next.knowledgeRoot };
  listeners.forEach((l) => l());
}

/** Strip the two timestamps the store mints. Everything else travels. */
function toInput(registry: Registry): DevRegistryInput {
  const { createdAt: _c, updatedAt: _u, ...input } = registry;
  return input;
}

/**
 * One-time adoption of the localStorage wiring, run only when the table is
 * empty.
 *
 * **The blob is left in place, deliberately, until 2026-12-31.** Deleting it in
 * the same release that stops reading it means an operator who rolls back to
 * the previous build finds their wiring gone, with no way to get it back but
 * to redo it by hand. It is read once, never written, and the only cost of
 * keeping it is a few kilobytes of dead storage. Delete the key and this
 * function together after that date.
 */
function readLocalBlob(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch (e) {
    // Private mode or blocked site data. Nothing to adopt, and the table is
    // the authority either way — but a silent skip here looks exactly like
    // "there was nothing to import", which is the one thing it must not.
    silentCatch('registryLinkStore:blobRead')(e);
    return null;
  }
}

/** A blank or missing value from the blob is ABSENT, not an empty string. */
function absent(value: string | null | undefined): string | null {
  return value?.trim() ? value : null;
}

async function adoptLocalBlob(): Promise<RegistryLinkSnapshot | null> {
  const raw = readLocalBlob();
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as {
      registries?: Record<string, Partial<Registry>>;
      workspaceRegistry?: Record<string, string>;
    };
    const now = new Date().toISOString();
    const registries: DevRegistryInput[] = Object.entries(parsed.registries ?? {})
      .filter(([, r]) => Boolean(r?.clonePath?.trim()))
      // The blob's entries carry exactly the fields `DevRegistryInput` names —
      // the backend type was modelled on this shape — but they came out of
      // JSON, so each one is read by name with a fallback rather than asserted
      // into the type wholesale.
      //
      // `url` and `credentialId` are coerced through `absent`, and that is not
      // defensive spelling: the build that WROTE this blob stored `''` in both
      // for every local checkout, because its type could not say "no remote".
      // Importing those straight through would carry that claim into a column
      // made nullable precisely to stop making it. The fallback also still
      // earns its keep — the blob is parsed as `Partial<Registry>`, so a
      // hand-edited or truncated one can omit the key outright.
      .map(([id, r]) => ({
        id,
        fullName: r.fullName ?? id,
        url: absent(r.url),
        defaultBranch: r.defaultBranch ?? 'main',
        credentialId: absent(r.credentialId),
        clonePath: r.clonePath ?? '',
        state: r.state ?? 'unlinked',
        sessionId: r.sessionId ?? null,
        lanes: Array.isArray(r.lanes) ? r.lanes : [],
        domains: Array.isArray(r.domains) ? r.domains : [],
        sha: r.sha ?? null,
        pairedAt: r.pairedAt ?? null,
        error: r.error ?? null,
      }));
    const byId = new Set(registries.map((r) => r.id));
    const links: WorkspaceRegistryLink[] = Object.entries(parsed.workspaceRegistry ?? {})
      // A hold on a registry the blob no longer carries is not importable, and
      // sending it would only produce a refusal the backend logs.
      .filter(([, registryId]) => byId.has(registryId))
      .map(([workspaceId, registryId]) => ({ workspaceId, registryId, linkedAt: now }));
    if (registries.length === 0) return null;

    return await importRegistryLinks(registries, links);
  } catch (e) {
    // A corrupt blob must not take the workspace panel down with it, and must
    // not leave the store stuck pre-load either: the caller falls back to what
    // the table says, which for a fresh install is nothing.
    silentCatch('registryLinkStore:adopt')(e);
    return null;
  }
}

async function load(): Promise<void> {
  const fromDb = await registrySnapshot();
  if (fromDb.registries.length === 0 && fromDb.links.length === 0) {
    const adopted = await adoptLocalBlob();
    if (adopted) {
      publish(adopted);
      return;
    }
  }
  publish(fromDb);
}

/** Re-read the whole wiring. Every mutator ends here, so the view and the
 *  table cannot disagree about what the last write did. */
async function refresh(): Promise<void> {
  publish(await registrySnapshot());
}

function ensureLoaded(): void {
  if (loadStarted) return;
  loadStarted = true;
  void load().catch(silentCatch('registryLinkStore:load'));
}

export function subscribeRegistryLinks(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function registryLinkSnapshot(): Snapshot {
  ensureLoaded();
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
export async function linkRegistry(
  workspaceId: string,
  repo: { fullName: string; defaultBranch: string },
  credentialId: string,
  clonePath: string,
): Promise<Registry> {
  const s = registryLinkSnapshot();
  const id = repo.fullName;
  const existing = s.registries[id];

  const input: DevRegistryInput = existing
    ? toInput(existing)
    : {
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

  await upsertRegistry(input);
  const registry = await linkRegistryToWorkspace(workspaceId, id);
  await refresh();
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
export async function linkLocalRegistry(
  workspaceId: string,
  folderPath: string,
  probe: {
    name: string | null;
    fullName: string | null;
    lanes: string[];
    domains: string[];
    headSha: string | null;
  },
): Promise<Registry> {
  const s = registryLinkSnapshot();
  const path = folderPath.trim();
  const id = probe.fullName ?? probe.name ?? path;
  const existing = s.registries[id];

  const input: DevRegistryInput = {
    ...(existing
      ? toInput(existing)
      : {
          id,
          fullName: probe.fullName ?? probe.name ?? path,
          // A local checkout the catalog does not know has no remote at all,
          // and never needs a credential — both are absent by kind, which is
          // what the nullable columns exist to record.
          url: probe.fullName ? `https://github.com/${probe.fullName}` : null,
          defaultBranch: 'main',
          credentialId: null,
          clonePath: path,
          state: 'unlinked' as const,
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

  await upsertRegistry(input);
  const registry = await linkRegistryToWorkspace(workspaceId, id);
  await refresh();
  return registry;
}

/** Detach a workspace. The registry survives while any other workspace holds it. */
export async function unlinkRegistry(workspaceId: string): Promise<void> {
  await unlinkRegistryFromWorkspace(workspaceId);
  await refresh();
}

/**
 * Merge a partial change into a registry and write the whole row back.
 *
 * The merge happens here rather than in a field-wise backend door because the
 * view already holds the row: one way to write a registry means one place where
 * "absent" has to mean something.
 */
export async function patchRegistry(id: string, patch: Partial<Registry>): Promise<void> {
  const current = registryLinkSnapshot().registries[id];
  if (!current) return;
  await upsertRegistry(toInput({ ...current, ...patch }));
  await refresh();
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
  // A registry with no remote is a local checkout, which is linked directly
  // and never dispatched here — but the step has to say something true if it
  // ever is, and "Clone null" is the one thing it must not say.
  const step1 = registry.url
    ? `1. Clone ${registry.url} (branch ${registry.defaultBranch}) to ${clonePath} if it is not already there; otherwise fetch and report the current commit.`
    : `1. The working copy at ${clonePath} is the registry; there is no remote to clone. Report the current commit.`;
  return [
    `Pair this machine with the knowledge registry ${registry.fullName}.`,
    '',
    step1,
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
  await patchRegistry(registry.id, { state: 'pairing', error: null });
  try {
    const session = await spawnSession(cwd, ['-p', pairingBrief(registry)]);
    const sessionId = typeof session === 'string' ? session : ((session as { id?: string })?.id ?? null);
    await patchRegistry(registry.id, { sessionId });
  } catch (e) {
    await patchRegistry(registry.id, {
      state: 'error',
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
