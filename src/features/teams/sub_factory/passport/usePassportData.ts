// Live passport data for the project-readiness Wall. Joins each dev_tools
// project (DevProject row) with the cross-project-metadata scan output and
// derives an App Readiness Passport per project. `rescan()` re-runs the scan
// (dev_tools_generate_cross_project_metadata) and re-derives — that scan IS the
// passport-data gatherer. `reload()` re-derives from the cached scan + fresh
// project rows (used after a Tier-0 config write — no need to re-scan).
import { useCallback, useEffect, useState } from 'react';

import { listProjects, getCrossProjectMetadata, generateCrossProjectMetadata, listSkills, listSkillsGlobal, probeRepoEvidence, type RepoEvidence } from '@/api/devTools/devTools';
import { derivePassportFromMetadata } from './passportDerive';
import { recordSnapshot } from './passportHistory';
import { sortByNameAsc, type AppPassport } from './passportModel';
import type { ImproveRaw } from './improve/ImproveContext';

interface PassportData {
  passports: AppPassport[];
  /** Raw DevProject + scan metadata per project id — backs the improve engine. */
  rawByProject: Map<string, ImproveRaw>;
  loading: boolean;
  error: string | null;
  /** ISO timestamp of the scan the passports were derived from. */
  generatedAt: string | null;
  rescanning: boolean;
  /** Re-run the cross-project scan and re-derive every passport. */
  rescan: () => void;
  /** Re-fetch project rows + re-derive from the cached scan (post config write). */
  reload: () => void;
}

const EMPTY = new Map<string, ImproveRaw>();

export function usePassportData(): PassportData {
  const [state, setState] = useState<{ passports: AppPassport[]; rawByProject: Map<string, ImproveRaw>; loading: boolean; error: string | null; generatedAt: string | null }>(
    { passports: [], rawByProject: EMPTY, loading: true, error: null, generatedAt: null },
  );
  const [rescanning, setRescanning] = useState(false);

  const build = useCallback(async (regen: boolean) => {
    const [projects, cached] = await Promise.all([
      listProjects(),
      regen ? generateCrossProjectMetadata() : getCrossProjectMetadata(),
    ]);
    // First run (no cached scan yet) → generate one so the Wall is never empty
    // when projects exist but have never been cross-scanned.
    const map = cached ?? (await generateCrossProjectMetadata());
    const byId = new Map(projects.map((p) => [p.id, p]));

    // Reusable skills: each project's .claude/skills + the global library. Build a
    // catalog (name → first source) so a project can adopt skills its siblings have.
    const [globalSkills, projectSkillLists] = await Promise.all([
      listSkillsGlobal().catch(() => []),
      Promise.all(map.projects.map((m) => listSkills(m.project_id).then((s) => [m.project_id, s] as const).catch(() => [m.project_id, []] as const))),
    ]);
    const skillCatalog = new Map<string, { source: string | null; description: string | null }>();
    for (const g of globalSkills) if (!skillCatalog.has(g.name)) skillCatalog.set(g.name, { source: null, description: g.description });
    for (const [pid, list] of projectSkillLists) for (const s of list) if (!skillCatalog.has(s.name)) skillCatalog.set(s.name, { source: pid, description: s.description });
    const installedByProject = new Map(projectSkillLists.map(([pid, list]) => [pid, new Set(list.map((s) => s.name))]));

    // Deep evidence (D1): a deterministic file probe per project, in parallel.
    // Defensive — null on older builds (command unregistered) or unreadable paths,
    // in which case the derive falls back to its heuristics.
    const evidenceById = new Map<string, RepoEvidence | null>();
    await Promise.all(map.projects.map(async (m) => {
      const proj = byId.get(m.project_id);
      const ev = proj?.root_path ? await probeRepoEvidence(proj.root_path).catch(() => null) : null;
      evidenceById.set(m.project_id, ev);
    }));

    const rawByProject = new Map<string, ImproveRaw>();
    const passports: AppPassport[] = [];
    for (const meta of map.projects) {
      const project = byId.get(meta.project_id);
      if (!project) continue;
      const installed = installedByProject.get(meta.project_id) ?? new Set<string>();
      const hasSkills = installed.size > 0;
      const evidence = evidenceById.get(meta.project_id) ?? null;
      const skillsToAdd = [...skillCatalog.entries()]
        .filter(([name, info]) => !installed.has(name) && info.source !== meta.project_id)
        .map(([name, info]) => ({ name, source: info.source, description: info.description }));
      rawByProject.set(project.id, { project, meta, hasSkills, skillsToAdd, evidence });
      passports.push(derivePassportFromMetadata(meta, project, { hasSkills, evidence }));
    }
    const sorted = sortByNameAsc(passports);
    // Append to the local readiness history (deduped) so the cover sparkline +
    // "since last scan" delta accrue across scans. Best-effort, never blocks.
    recordSnapshot(sorted, Date.now());
    setState({ passports: sorted, rawByProject, loading: false, error: null, generatedAt: map.generated_at });
  }, []);

  useEffect(() => {
    let cancelled = false;
    build(false).catch((e) => {
      if (!cancelled) setState((s) => ({ ...s, loading: false, error: e instanceof Error ? e.message : String(e) }));
    });
    return () => { cancelled = true; };
  }, [build]);

  const rescan = useCallback(() => {
    setRescanning(true);
    build(true)
      .catch((e) => setState((s) => ({ ...s, error: e instanceof Error ? e.message : String(e) })))
      .finally(() => setRescanning(false));
  }, [build]);

  const reload = useCallback(() => {
    build(false).catch((e) => setState((s) => ({ ...s, error: e instanceof Error ? e.message : String(e) })));
  }, [build]);

  // Refresh the Wall when a Factory-initiated deploy/scan finishes while the user
  // is still viewing it. eventBridge dispatches `factory-process-complete` after
  // resolving the activity-dock entry (globally, so it fires regardless of which
  // module is open); navigating away + back already remounts + reloads, so this
  // covers the stay-on-page case. A SCAN regenerates the cross-project metadata
  // (build(true)) — the context-graph level is derived from that aggregate, so a
  // plain re-derive off the cache would leave the score unchanged after a scan; a
  // DEPLOY only changed the repo, so a cheap re-derive from fresh project rows is
  // enough. Debounced so a burst of completions coalesces into one rebuild.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onComplete = (e: Event) => {
      const kind = (e as CustomEvent<{ kind?: string }>).detail?.kind;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        build(kind === 'scan').catch((err) =>
          setState((s) => ({ ...s, error: err instanceof Error ? err.message : String(err) })),
        );
      }, 1200);
    };
    window.addEventListener('personas:factory-process-complete', onComplete);
    return () => {
      window.removeEventListener('personas:factory-process-complete', onComplete);
      if (timer) clearTimeout(timer);
    };
  }, [build]);

  return { ...state, rescanning, rescan, reload };
}
