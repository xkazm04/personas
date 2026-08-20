// Unified skills-workbench data + operations — the single hook behind BOTH the
// Passport wall and the Mastermind canvas. It folds the three skill lanes into
// one shape so the shared UI never branches on entry point:
//   · MANAGE / adopt   — library or sibling skills missing here (skillsToAdd)
//   · MANAGE / share   — this repo's skills the library lacks (skillsToShare)
//   · DISPATCH         — installed skills (.claude/skills), run via Fleet
// Management dispatches Dev-runner tasks (engine.deployNow) and locks the
// skills cell; Dispatch spawns a background Fleet session. All three are the
// same "pick a skill → act" gesture, so the panes stay identical.
import { useCallback, useEffect, useMemo, useState } from 'react';

import { listSkills, stampSkillProvenance, syncRegistryClone, writeRegistryUsage, type SkillEntry } from '@/api/devTools/devTools';
import { usageFileFor } from '@/features/plugins/dev-tools/sub_workspaces/registry/useRegistryLibrary';
import { spawnExternalConsole, spawnSession, writeDispatchBrief } from '@/api/fleet/fleet';
import { silentCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';
import { useToastStore } from '@/stores/toastStore';
import { useImproveActivityStore } from '@/stores/improveActivityStore';

import { useImprove } from './ImproveContext';
import { adoptTaskPrompt, adoptTaskTitle, shareTaskPrompt, shareTaskTitle, type AdoptItem, type ShareTarget } from './skillTasks';

/** Skill adopt/share is always resolved by Sonnet (medium thinking is the
 *  dev-runner default effort). Pinned here so the personalization/generalization
 *  quality is consistent regardless of the app's default task model. */
const SKILL_TASK_MODEL = 'claude-sonnet-5';

/**
 * Sync before scan — fast-forward a paired registry clone before dispatching a
 * task that reads or writes it.
 *
 * It lives here, next to `deployNow`, rather than at each call site: the
 * invariant is "no skill task ever runs against a clone we have not just
 * confirmed is current", and putting it at the dispatch boundary means a future
 * caller inherits it instead of having to remember it.
 *
 * Rethrows on failure, which ABORTS the dispatch. That is the point — an
 * unreachable remote, a dirty tree or unpushed local commits are all things the
 * operator has to look at, and running the task anyway would produce exactly the
 * confidently-wrong result (a share branched off stale history, an adopt of a
 * superseded skill) that syncing exists to prevent.
 *
 * A null path is the home library, which has no remote and needs no sync.
 */
async function syncBeforeDispatch(clonePath: string | null | undefined): Promise<void> {
  if (!clonePath) return;
  await syncRegistryClone(clonePath);
}

/** Surface a sync refusal with the backend's own sentence — it already names
 *  which of connectivity / mapping / local state the operator should look at,
 *  and a generic "sync failed" would throw that away. */
function syncFailureMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  return raw.trim() ? `Registry not synced — ${raw.split('\n')[0]}` : 'Registry not synced';
}

export type WorkbenchMode = 'manage' | 'dispatch';

/** A usage rollup as the panes render it (30-day invokes + last-invoked). */
export interface SkillUsage { invokes30d: number; lastInvokedAt: string | null; dormant?: boolean }

/** One row in a lane's list — normalized across adopt / share / dispatch. */
export interface WorkbenchSkill {
  name: string;
  description: string | null;
  /** Human source label ("Global library", a project name, or install origin). */
  sourceLabel: string | null;
  /** Usage telemetry, when known. */
  usage: SkillUsage | null;
  /** Canonical category (Development/Testing/Maintenance/Data/Other); null
   *  renders under "Other". Assigned by the share LLM in SKILL.md frontmatter. */
  category: string | null;
  /** Memory binding (project|vault|none) — installed skills only. */
  memory?: string | null;
  /** `contexts: tracked` declaration — installed skills only. */
  contextTracked?: boolean;
}

export interface SkillsWorkbench {
  projectName: string;
  counts: { reused: number; own: number; dormant?: number };
  adopt: { items: WorkbenchSkill[] };
  share: { items: WorkbenchSkill[] };
  dispatch: { items: WorkbenchSkill[]; loading: boolean };
  /** A management task (adopt/share) is running for this project's skills cell. */
  managing: boolean;
  /** A dispatch spawn is in flight (local optimistic guard). */
  dispatching: boolean;
  /** Adopt one library skill into this project. `libraryRoot` names WHICH library
   *  the item comes from — omit for the user-global one. */
  /** `libraryRoot` is the lane to read FROM; `clonePath` is the registry working
   *  copy to fast-forward first (omit for the home library, which has no remote). */
  runAdopt: (name: string, libraryRoot?: string | null, clonePath?: string | null) => Promise<void>;
  /** Publish a project skill into the library. `target` decides WHERE and under
   *  which contract — omit it for the user-global library. */
  runShare: (name: string, target?: ShareTarget) => Promise<void>;
  runDispatch: (name: string, args: string) => Promise<void>;
  /** Same skill run, but in a NEW terminal window the operator owns — the app
   *  cd's to the repo root, launches the Claude CLI there and seeds it with the
   *  `/skill …` command. Takes the WHOLE batch and opens exactly ONE window:
   *  see `consolePrompt`. Rejects when no console can be opened (non-Windows,
   *  CLI missing); the caller falls back to copying the commands. */
  runConsole: (name: string, argSets: string[]) => Promise<void>;
}

/** The Fleet prompt for a skill run: `/name` plus any trimmed args. A leading
 *  slash in the first prompt is recognized by Claude as a slash command. */
export function skillCommand(name: string, args: string): string {
  const a = args.trim();
  return a ? `/${name} ${a}` : `/${name}`;
}

/** Where a batch list lands when it is too long to inline. Under `.personas/`
 *  because that dir is already the app↔skill handshake and is gitignored in
 *  every managed repo. */
export const BATCH_BRIEF_PATH = '.personas/skill-batch.md';

/** Above this many characters of command list, the batch travels as a file
 *  instead of inline. Well under the ~32 KB Windows command-line ceiling, with
 *  room for the surrounding instructions. */
const INLINE_BATCH_LIMIT = 4000;

/**
 * The seed prompt for a console run, plus the brief file to write first (null
 * when everything fits inline).
 *
 * A single arg set stays a bare `/skill args` so the CLI recognizes it as a
 * slash command and the session opens mid-invocation. A batch CANNOT: appending
 * more text to a slash command would be swallowed as arguments, so the batch
 * seed is prose that lists the commands and asks for them one at a time. The
 * session invokes the skill itself per line — one window, N sequential runs.
 */
export function consolePrompt(name: string, argSets: string[]): { prompt: string; brief: string | null } {
  const sets = argSets.length ? argSets : [''];
  if (sets.length === 1) return { prompt: skillCommand(name, sets[0] ?? ''), brief: null };

  const commands = sets.map((a) => skillCommand(name, a));
  const list = commands.map((c) => `- ${c}`).join('\n');
  const head =
    `Run the /${name} skill ${sets.length} times in this session, once per line below. `
    + 'Work through them IN ORDER and finish each run completely before starting the next '
    + '— do not run them in parallel, and do not batch them into a single invocation. '
    + 'If one run fails, say so and carry on with the rest.';

  if (list.length <= INLINE_BATCH_LIMIT) {
    return { prompt: `${head}\n\n${list}`, brief: null };
  }
  return {
    prompt: `${head}\n\nThe ${sets.length} commands are listed in ${BATCH_BRIEF_PATH} — read that file first.`,
    brief: `# /${name} batch\n\n${sets.length} runs, in order:\n\n${list}\n`,
  };
}

/** Best-effort usage hint from a skill's description (skills document invocation
 *  inconsistently): a backticked slash-command span, else an "Invoke with …"
 *  clause, else null (the caller shows the plain description instead). */
export function usageHint(description: string | null): string | null {
  if (!description) return null;
  const code = description.match(/`(\/[a-z0-9][^`]*)`/i);
  if (code?.[1]) return code[1].trim();
  const invoke = description.match(/Invoke with[:\s]+([^.]+)/i);
  if (invoke?.[1]) return invoke[1].replace(/`/g, '').trim();
  return null;
}

/** Assemble the workbench for a project. Returns null when the improve engine
 *  or the project's raw row isn't available (caller renders nothing). */
export function useSkillsWorkbench(slug: string): SkillsWorkbench | null {
  const engine = useImprove();
  const addToast = useToastStore((s) => s.addToast);
  const managing = useImproveActivityStore((s) => Boolean(s.byCell[`${slug}:skills`]));
  const [installed, setInstalled] = useState<SkillEntry[]>([]);
  const [loadingInstalled, setLoadingInstalled] = useState(true);
  const [dispatching, setDispatching] = useState(false);

  const raw = engine?.getRaw(slug);

  // Installed skills (dispatch lane) — fetched once per open, name-asc.
  useEffect(() => {
    let alive = true;
    setLoadingInstalled(true);
    listSkills(slug)
      .then((rows) => { if (alive) setInstalled([...rows].sort((a, b) => a.name.localeCompare(b.name))); })
      .catch((e) => { silentCatch('skillsWorkbench listSkills')(e); if (alive) setInstalled([]); })
      .finally(() => { if (alive) setLoadingInstalled(false); });
    return () => { alive = false; };
  }, [slug]);

  const sourceLabel = useCallback((source: string | null): string =>
    source === null ? 'Global library' : engine?.getRaw(source)?.project.name ?? 'another project',
    [engine]);
  const sourceRootOf = useCallback((projectId: string): string | null =>
    engine?.getRaw(projectId)?.project.root_path ?? null, [engine]);

  const adoptItems = useMemo<WorkbenchSkill[]>(() => {
    const list = raw?.skillsToAdd ?? [];
    return [...list].sort((a, b) => a.name.localeCompare(b.name)).map((s) => {
      const u = raw?.catalogUsage?.[s.name];
      return { name: s.name, description: s.description, sourceLabel: sourceLabel(s.source), usage: u ? { invokes30d: u.invokes30d, lastInvokedAt: u.lastInvokedAt } : null, category: s.category };
    });
  }, [raw, sourceLabel]);

  const shareItems = useMemo<WorkbenchSkill[]>(() => {
    const list = raw?.skillsToShare ?? [];
    return [...list].sort((a, b) => a.name.localeCompare(b.name)).map((s) => {
      const u = raw?.skillUsage?.[s.name];
      return { name: s.name, description: s.description, sourceLabel: null, usage: u ?? null, category: s.category };
    });
  }, [raw]);

  const dispatchItems = useMemo<WorkbenchSkill[]>(() =>
    installed.map((s) => {
      const u = raw?.skillUsage?.[s.name];
      return { name: s.name, description: s.description, sourceLabel: s.sourceKind, usage: u ?? null, category: s.category, memory: s.memory, contextTracked: s.contextTracked };
    }), [installed, raw]);

  const runAdopt = useCallback(async (name: string, libraryRoot?: string | null, clonePath?: string | null) => {
    if (!engine || !raw) return;
    const src = raw.skillsToAdd?.find((s) => s.name === name);
    if (!src) return;
    const items: AdoptItem[] = [{ name: src.name, source: src.source }];
    // Before the read, not after: adopting from a stale clone personalizes a
    // version the library has already moved past, and the copy would land
    // looking `in_sync` against it.
    try {
      await syncBeforeDispatch(clonePath);
    } catch (e) {
      addToast(syncFailureMessage(e), 'error');
      throw e;
    }
    try {
      const taskId = await engine.deployNow(slug, adoptTaskTitle(items), adoptTaskPrompt(items, sourceRootOf, libraryRoot), SKILL_TASK_MODEL);
      useImproveActivityStore.getState().start(`${slug}:skills`, taskId, 'deploy');
      // The LLM adopt lane writes skill files without the provenance sidecar
      // (unlike skill_files_install), which left such skills `local_only`
      // forever. Stamp it once the cell's terminal event clears the activity —
      // one-shot subscription; stamping is best-effort (false when dirs are
      // missing, e.g. the task failed before writing).
      const unsubscribe = useImproveActivityStore.subscribe((s) => {
        if (s.byCell[`${slug}:skills`]) return;
        unsubscribe();
        stampSkillProvenance(name, slug, src.source).catch(silentCatch('skillsWorkbench stamp provenance'));
      });
      addToast(`Claude is adopting “${name}” into ${raw.project.name}, customized for its codebase`, 'success');
    } catch (e) {
      addToast('Couldn’t start the skill task', 'error');
      throw e;
    }
  }, [engine, raw, slug, sourceRootOf, addToast]);

  const runShare = useCallback(async (name: string, target?: ShareTarget) => {
    if (!engine || !raw) return;
    // A share COMMITS into the clone. Branching off history the remote has
    // already advanced past is the failure this ordering exists to stop.
    try {
      await syncBeforeDispatch(target?.kind === 'registry' ? target.clonePath : null);
    } catch (e) {
      addToast(syncFailureMessage(e), 'error');
      throw e;
    }

    // The usage piggyback is written AFTER the sync, and this order is load
    // bearing: the file lands in the clone's working tree, so writing it first
    // would make the tree dirty and the sync would refuse — every registry
    // share would fail on the safety check meant to protect it.
    //
    // Still best-effort. Failing to contribute counts must never block
    // publishing a skill; a failure just drops the piggyback.
    let effective = target;
    if (target?.kind === 'registry') {
      const usageFile = await writeRegistryUsage(target.clonePath, target.contributor)
        .then((n) => (n > 0 ? usageFileFor(target.contributor) : null))
        .catch((e: unknown) => {
          silentCatch('skillsWorkbench registry usage')(e);
          return null;
        });
      effective = { ...target, usageFile };
    }

    try {
      const taskId = await engine.deployNow(slug, shareTaskTitle(name), shareTaskPrompt(name, raw.project, effective), SKILL_TASK_MODEL);
      useImproveActivityStore.getState().start(`${slug}:skills`, taskId, 'deploy');
      addToast(`Claude is generalizing “${name}” into your library`, 'success');
    } catch (e) {
      addToast('Couldn’t start the skill task', 'error');
      throw e;
    }
  }, [engine, raw, slug, addToast]);

  const runDispatch = useCallback(async (name: string, args: string) => {
    if (!raw?.project.root_path) return;
    setDispatching(true);
    try {
      await spawnSession(raw.project.root_path, [skillCommand(name, args)]);
      void useSystemStore.getState().fleetRefresh();
      addToast(`Running /${name} in ${raw.project.name}`, 'success');
    } catch (e) {
      addToast('Couldn’t start the Fleet session', 'error');
      throw e;
    } finally {
      setDispatching(false);
    }
  }, [raw, addToast]);

  // The console lane. No toast here and no `dispatching` guard: the app keeps
  // no handle on the window it opens (see fleet/external.rs), so there is
  // nothing to reconcile and nothing to debounce against — and the caller
  // needs the rejection to decide whether to fall back to the clipboard.
  // `skipPermissions` matches the Fleet lane: a skill run walks the whole repo,
  // and a prompt-per-file console is unusable.
  //
  // ONE window for the whole batch, never one per arg set. Fleet can afford
  // one background session per context because it manages them; a console is
  // an OS window the operator has to close by hand, so "all contexts" on this
  // repo would have meant 767 of them.
  const runConsole = useCallback(async (name: string, argSets: string[]) => {
    const root = raw?.project.root_path;
    if (!root) throw new Error('project has no root path on disk');

    const { prompt, brief } = consolePrompt(name, argSets);
    // A batch list can outgrow the ~32 KB Windows command line, so past the
    // inline threshold the list travels as a file the prompt points at — the
    // same trick the passport's populate dispatch uses. It also lets the
    // operator re-run the batch after closing the window.
    if (brief) await writeDispatchBrief(root, BATCH_BRIEF_PATH, brief);

    await spawnExternalConsole({ cwd: root, prompt, skipPermissions: true });
  }, [raw]);

  if (!engine || !raw) return null;

  return {
    projectName: raw.project.name,
    counts: raw.skillCounts ?? { reused: 0, own: 0 },
    adopt: { items: adoptItems },
    share: { items: shareItems },
    dispatch: { items: dispatchItems, loading: loadingInstalled },
    managing,
    dispatching,
    runAdopt,
    runShare,
    runDispatch,
    runConsole,
  };
}
