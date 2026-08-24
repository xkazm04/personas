// Skill Launch data spine — one skill x the workspace's projects, with a
// launch affordance per cell.
//
// Rows come from the same library every Skills tab reads: `useRegistryLibrary`
// resolves the wired registry's `skills/` lane when the workspace holds one,
// and otherwise falls back to the lane the active project's repo declares in
// `.ai/manifest.yaml` (the fallback used to live inline here; it moved into
// the hook so Overview/Registry/Trace resolve identically).
//
// Per (selected skill, project) cell: installed? (with version/syncState),
// adopting? (local in-flight install), running? (a live Fleet session in that
// project's cwd invoking the skill). `launch` hands the run to Athena via the
// companion pending-prompt door (the AddKpiModal mechanism) so she composes
// the fleet plan, gathers arguments and stewards the run.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  installSkill, installSystemSkill, listSkills, listSkillsGlobal,
  type SkillEntry,
} from '@/api/devTools/devTools';
import { listSessions } from '@/api/fleet/fleet';
import { useCompanionStore } from '@/features/plugins/companion/companionStore';
import type { DevProject } from '@/lib/bindings/DevProject';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import { mapWithConcurrency } from '@/lib/concurrency';
import { getActiveTranslations, interpolate as tx } from '@/i18n/useTranslation';
import { silentCatch, toastCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';
import { useToastStore } from '@/stores/toastStore';

import { isPresetSkill } from '../../constants/presetSkills';
import { useRegistryLibrary } from '../../sub_workspaces/registry/useRegistryLibrary';
import { useWorkspaces, workspaceOf } from '../../sub_workspaces/workspaceStore';
import { parseSkillArg } from '../analytics/useSkillsAnalytics';
import type { LaunchStatus, ProjectLaunchCell, SkillLaunchData } from './launchTypes';

/** Fleet states that mean the session is still doing work (registry:45). */
export const LIVE_STATES = new Set(['spawning', 'running', 'awaiting_input']);

/** Poll cadence for the Fleet snapshot while the tab is mounted. */
const POLL_MS = 5000;

/** Normalize a path for cwd <-> root matching (mirrors useSkillsRegistry). */
export function normPath(p: string): string {
  return p.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
}

/** Adopting-set key. */
export function launchKey(skill: string, projectId: string): string {
  return `${skill}:${projectId}`;
}

/**
 * Does this session's arg vector invoke the skill? Primary: the first arg is
 * the `/skill ...` slash command (parseSkillArg). Secondary: ANY arg equals
 * `/skill` or contains `/skill ` — Athena-dispatched sessions carry the same
 * /skill arg shape but not necessarily in first position.
 */
export function argsInvokeSkill(args: string[], skill: string): boolean {
  if (parseSkillArg(args)?.skill === skill) return true;
  const token = `/${skill}`;
  return args.some((a) => a === token || a.includes(`${token} `));
}

/** Is this session a live run of `skill` inside `projectRoot`? */
export function sessionRunsSkill(
  session: { args: string[]; cwd: string; state: string },
  skill: string,
  projectRoot: string,
): boolean {
  if (!LIVE_STATES.has(session.state)) return false;
  if (normPath(session.cwd) !== normPath(projectRoot)) return false;
  return argsInvokeSkill(session.args, skill);
}

/** Status precedence: running > adopting > installed(ready) > needs_adopt. */
export function deriveLaunchStatus(input: {
  running: boolean; adopting: boolean; installed: boolean;
}): LaunchStatus {
  if (input.running) return 'running';
  if (input.adopting) return 'adopting';
  return input.installed ? 'ready' : 'needs_adopt';
}

/** Split a declared `argument-hint` into display bullets. Top-level `|`
 * alternatives are whole forms (`resume <slug>` stays together); a single
 * form breaks into its bracketed/`<>` groups so each option reads on its own
 * line. Pure + exported for tests. */
export function parseArgumentHint(hint: string): string[] {
  // Split on `|` only at bracket depth 0 — `[init|scan|run]` is ONE group
  // whose pipes are its own alternative syntax, not separate forms.
  const forms: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of hint) {
    if (ch === '[' || ch === '<') depth++;
    else if (ch === ']' || ch === '>') depth = Math.max(0, depth - 1);
    if (ch === '|' && depth === 0) { forms.push(cur); cur = ''; }
    else cur += ch;
  }
  forms.push(cur);
  const trimmed = forms.map((f) => f.trim()).filter(Boolean);
  if (trimmed.length > 1) return trimmed;
  const only = trimmed[0] ?? '';
  const groups = only.match(/\[[^\]]+\]|<[^>]+>|[^\s[<]+/g) ?? [];
  // A leading bare verb glues to the first group ("run [--l2]" reads as one).
  return groups.length > 1 ? groups : [only];
}

/** Provenance label (`AppPromptRequest.source`) for turns this surface
 * forwards — the send path files them as tagged System turns
 * (`TurnOrigin::External`), so Athena is told the text is app-composed, not
 * the user's own words. */
export const LAUNCH_SYSTEM_SOURCE = 'Skills Launch';

/** The Athena ask `launch` seeds — machine-facing English, not i18n.
 * Deliberately NON-leading: it states what the user requested and nothing
 * more. Athena already knows how to inspect a skill, gather arguments and
 * compose a `show_fleet_plan`; dictating those steps here second-guessed her
 * and confused turns (consolidation feedback, 2026-08-24). */
export function composeLaunchAsk(skill: string, project: DevProject, argumentHint: string | null): string {
  const argLine = argumentHint ? ` Declared argument syntax: /${skill} ${argumentHint}.` : '';
  return `The user clicked Launch in Dev Tools > Skills: run the skill /${skill} `
    + `on the project "${project.name}" (cwd: ${project.root_path}).${argLine} `
    + `Dispatch it as a fleet run when you are ready.`;
}

export function useSkillLaunch(activeProjectId: string | null): SkillLaunchData {
  const { workspaces } = useWorkspaces();
  const allProjects = useSystemStore((s) => s.projects);
  const storeSessions = useSystemStore((s) => s.fleetSessions);
  const { libraryRoot, source: librarySource } = useRegistryLibrary(activeProjectId);

  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null);
  const [support, setSupport] = useState<Map<string, Map<string, SkillEntry>>>(new Map());
  const [registryWired, setRegistryWired] = useState(true);
  const [loading, setLoading] = useState(true);
  const [adopting, setAdopting] = useState<Set<string>>(new Set());
  const [polledSessions, setPolledSessions] = useState<FleetSession[]>([]);
  const [tick, setTick] = useState(0);

  // The workspace under inspection — the active project's, else the first one
  // (mirrors useSkillsRegistry:78-91, membership fallback included).
  const workspace = useMemo(
    () => (activeProjectId ? workspaceOf(workspaces, activeProjectId) : null) ?? workspaces[0] ?? null,
    [workspaces, activeProjectId],
  );
  const wsProjects = useMemo(() => {
    const members = (workspace?.projectIds ?? [])
      .map((id) => allProjects.find((p) => p.id === id))
      .filter((p): p is NonNullable<typeof p> => Boolean(p));
    // workspace_id is an optional assignment many DBs never write; degrade to
    // every active project instead of a dead launchpad.
    return members.length > 0 ? members : allProjects.filter((p) => p.status === 'active');
  }, [workspace, allProjects]);

  // -- Skill list + per-project support map (fan-out, bounded).
  const firstFetchDone = useRef(false);
  useEffect(() => {
    let alive = true;
    if (!firstFetchDone.current) setLoading(true);
    // Library resolution (registry > repo manifest > home) lives in
    // useRegistryLibrary; a null source means its manifest probe is still in
    // flight — hold the fetch so we never briefly paint the home library.
    if (librarySource === null) return () => { alive = false; };
    // Both roots null (source 'home') = nothing wired anywhere.
    setRegistryWired(libraryRoot != null);
    void (async () => {
      const [globalSkills, perInstalled] = await Promise.all([
        listSkillsGlobal(libraryRoot).catch((e) => { silentCatch('skillLaunch library')(e); return [] as SkillEntry[]; }),
        mapWithConcurrency(wsProjects, 6, async (p) => ({
          pid: p.id,
          installed: await listSkills(p.id).catch((e) => { silentCatch('skillLaunch listSkills')(e); return [] as SkillEntry[]; }),
        })),
      ]);
      if (!alive) return;
      // listSkillsGlobal is already name-asc; re-sort defensively.
      setSkills([...globalSkills].sort((a, b) => a.name.localeCompare(b.name)));
      setSupport(new Map(perInstalled.map((r) => [r.pid, new Map(r.installed.map((s) => [s.name, s]))])));
      firstFetchDone.current = true;
      setLoading(false);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace?.id, wsProjects.length, libraryRoot, librarySource, tick]);

  // -- Fleet liveness. The store's fleetSessions can be stale when the Fleet
  // tab was never opened (listeners attach there), so poll the registry
  // snapshot ourselves while mounted, like useHarvestAutoIngest does.
  useEffect(() => {
    let alive = true;
    const poll = () => {
      listSessions()
        .then((snap) => { if (alive) setPolledSessions(snap.sessions); })
        .catch(silentCatch('skillLaunch sessions'));
    };
    poll();
    const id = window.setInterval(poll, POLL_MS);
    return () => { alive = false; window.clearInterval(id); };
  }, []);

  const sessions = useMemo(() => {
    // Union by id; the fresher polled snapshot wins over the store cache.
    const byId = new Map<string, FleetSession>();
    for (const s of storeSessions) byId.set(s.id, s);
    for (const s of polledSessions) byId.set(s.id, s);
    return [...byId.values()];
  }, [storeSessions, polledSessions]);

  const cells: ProjectLaunchCell[] = useMemo(() => {
    if (!selectedSkill) return [];
    const lib = skills.find((s) => s.name === selectedSkill) ?? null;
    return wsProjects.map((project) => {
      const entry = support.get(project.id)?.get(selectedSkill) ?? null;
      const running = sessions.some((s) =>
        sessionRunsSkill({ args: s.args, cwd: s.cwd, state: String(s.state) }, selectedSkill, project.root_path));
      const isAdopting = adopting.has(launchKey(selectedSkill, project.id));
      return {
        project,
        status: deriveLaunchStatus({ running, adopting: isAdopting, installed: entry != null }),
        installedVersion: entry?.version ?? null,
        libraryVersion: lib?.version ?? null,
        syncState: entry?.syncState ?? null,
        running,
        adopting: isAdopting,
      };
    });
  }, [selectedSkill, skills, wsProjects, support, sessions, adopting]);

  // Mirrors RegistryTab.runAdopt: preset -> system install, else library copy;
  // in-flight key locks the cell; errors via toastCatch; support map refreshes
  // on success. The confirm dialog is the UI layer's job — this just installs.
  const adopt = useCallback(async (cell: ProjectLaunchCell) => {
    const skill = selectedSkill;
    if (!skill) return;
    const key = launchKey(skill, cell.project.id);
    let started = false;
    setAdopting((prev) => {
      if (prev.has(key)) return prev;
      started = true;
      const next = new Set(prev); next.add(key); return next;
    });
    if (!started) return;
    try {
      // Bind the door's outcome - `installed: false, reason: "exists"` is a
      // real answer, and toasting success over it is the exact defect the
      // catalog-browse-and-apply census rule ratchets (SkillInstallModal
      // :79-92 is the sanctioned shape). Either way the refresh re-reads
      // reality, so the cell lands on what the filesystem actually holds.
      const result = isPresetSkill(skill)
        ? await installSystemSkill(skill, cell.project.id, false)
        : await installSkill(skill, null, cell.project.id, false);
      const t = getActiveTranslations();
      if (result.installed) {
        useToastStore.getState().addToast(
          tx(t.plugins.fleet.skill_install_success, {
            skill, project: cell.project.name, count: result.fileCount,
          }),
          'success',
        );
      } else {
        useToastStore.getState().addToast(
          tx(t.plugins.fleet.skill_install_exists, { skill, project: cell.project.name }),
          'warning',
        );
      }
      setTick((n) => n + 1);
    } catch (err) {
      toastCatch('skill launch adopt')(err);
    } finally {
      setAdopting((prev) => { const next = new Set(prev); next.delete(key); return next; });
    }
  }, [selectedSkill]);

  // Seed the companion chat with the composed ask. Same pending-prompt door
  // as AddKpiModal, but tagged with a systemSource so the turn renders as a
  // system divider and Athena is told the app (not the user) wrote the text.
  const launch = useCallback((cell: ProjectLaunchCell) => {
    if (cell.status !== 'ready' || !selectedSkill) return;
    const hint = skills.find((s) => s.name === selectedSkill)?.argumentHint ?? null;
    useCompanionStore.getState().setPendingChatPrompt({
      text: composeLaunchAsk(selectedSkill, cell.project, hint),
      source: LAUNCH_SYSTEM_SOURCE,
    });
  }, [selectedSkill, skills]);

  const refresh = useCallback(() => setTick((n) => n + 1), []);

  return { skills, selectedSkill, setSelectedSkill, cells, loading, registryWired, adopt, launch, refresh };
}
