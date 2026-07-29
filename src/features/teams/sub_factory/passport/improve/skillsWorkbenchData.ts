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

import { listSkills, type SkillEntry } from '@/api/devTools/devTools';
import { spawnSession } from '@/api/fleet/fleet';
import { silentCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';
import { useToastStore } from '@/stores/toastStore';
import { useImproveActivityStore } from '@/stores/improveActivityStore';

import { useImprove } from './ImproveContext';
import { adoptTaskPrompt, adoptTaskTitle, shareTaskPrompt, shareTaskTitle, type AdoptItem } from './skillTasks';

/** Skill adopt/share is always resolved by Sonnet (medium thinking is the
 *  dev-runner default effort). Pinned here so the personalization/generalization
 *  quality is consistent regardless of the app's default task model. */
const SKILL_TASK_MODEL = 'claude-sonnet-5';

export type WorkbenchMode = 'manage' | 'dispatch';
export type ManageDirection = 'adopt' | 'share';
/** Which single operation a lane offers — also the detail pane's action kind. */
export type LaneKind = 'adopt' | 'share' | 'dispatch';

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
  runAdopt: (name: string) => Promise<void>;
  runShare: (name: string) => Promise<void>;
  runDispatch: (name: string, args: string) => Promise<void>;
}

/** One resolved lane: the list to show + the single operation to run. Keeps the
 *  variants from re-deriving the mode/direction → items/op mapping. */
export interface Lane {
  kind: LaneKind;
  items: WorkbenchSkill[];
  loading: boolean;
  busy: boolean;
  run: (name: string, args: string) => Promise<void> | void;
  /** Copy for the empty list + empty detail states. */
  emptyList: string;
  emptyDetail: string;
}

export function resolveLane(wb: SkillsWorkbench, mode: WorkbenchMode, direction: ManageDirection): Lane {
  if (mode === 'dispatch') {
    return {
      kind: 'dispatch', items: wb.dispatch.items, loading: wb.dispatch.loading, busy: wb.dispatching,
      run: wb.runDispatch,
      emptyList: 'No skills installed in this project yet.',
      emptyDetail: 'Pick a skill to run it as a background Fleet session.',
    };
  }
  if (direction === 'adopt') {
    return {
      kind: 'adopt', items: wb.adopt.items, loading: false, busy: wb.managing,
      run: wb.runAdopt,
      emptyList: 'Nothing to adopt: this project already has every skill in your library.',
      emptyDetail: 'Pick a skill to install and customize it for this repo.',
    };
  }
  return {
    kind: 'share', items: wb.share.items, loading: false, busy: wb.managing,
    run: wb.runShare,
    emptyList: 'Nothing to share: every skill here is already in your library.',
    emptyDetail: 'Pick a skill to generalize and publish to your library.',
  };
}

/** The Fleet prompt for a skill run: `/name` plus any trimmed args. A leading
 *  slash in the first prompt is recognized by Claude as a slash command. */
export function skillCommand(name: string, args: string): string {
  const a = args.trim();
  return a ? `/${name} ${a}` : `/${name}`;
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

  const runAdopt = useCallback(async (name: string) => {
    if (!engine || !raw) return;
    const src = raw.skillsToAdd?.find((s) => s.name === name);
    if (!src) return;
    const items: AdoptItem[] = [{ name: src.name, source: src.source }];
    try {
      const taskId = await engine.deployNow(slug, adoptTaskTitle(items), adoptTaskPrompt(items, sourceRootOf), SKILL_TASK_MODEL);
      useImproveActivityStore.getState().start(`${slug}:skills`, taskId, 'deploy');
      addToast(`Claude is adopting “${name}” into ${raw.project.name}, customized for its codebase`, 'success');
    } catch (e) {
      addToast('Couldn’t start the skill task', 'error');
      throw e;
    }
  }, [engine, raw, slug, sourceRootOf, addToast]);

  const runShare = useCallback(async (name: string) => {
    if (!engine || !raw) return;
    try {
      const taskId = await engine.deployNow(slug, shareTaskTitle(name), shareTaskPrompt(name, raw.project), SKILL_TASK_MODEL);
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
  };
}
