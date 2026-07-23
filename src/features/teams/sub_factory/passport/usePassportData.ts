// Live passport data for the project-readiness Wall. Joins each dev_tools
// project (DevProject row) with the cross-project-metadata scan output and
// derives an App Readiness Passport per project. `rescan()` re-runs the scan
// (dev_tools_generate_cross_project_metadata) and re-derives — that scan IS the
// passport-data gatherer. `reload()` re-derives from the cached scan + fresh
// project rows (used after a Tier-0 config write — no need to re-scan).
import { useCallback, useEffect, useState } from 'react';

import { listProjects, getCrossProjectMetadata, generateCrossProjectMetadata, listSkills, listSkillsGlobal, probeRepoEvidence, scanSkillUsage, getSkillUsageOverview, scanDocRot, getDocRotOverview, type RepoEvidence, type SkillUsageRow, type DocRotRow } from '@/api/devTools/devTools';
import { silentCatch } from '@/lib/silentCatch';
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
    const [globalSkills, projectSkillLists, usageRows, docRotRows] = await Promise.all([
      listSkillsGlobal().catch(() => []),
      Promise.all(map.projects.map((m) => listSkills(m.project_id).then((s) => [m.project_id, s] as const).catch(() => [m.project_id, []] as const))),
      getSkillUsageOverview().catch(() => [] as SkillUsageRow[]),
      getDocRotOverview().catch(() => [] as DocRotRow[]),
    ]);
    // Doc-rot rollup per project (P2): dirty docs + tracked docs that no
    // session has ever read since telemetry began. Absent rows = scan hasn't
    // run for that project → no rollup, never a guessed zero.
    const docRotByProject = new Map<string, { tracked: number; dirty: number; neverRead: number }>();
    for (const r of docRotRows) {
      let agg = docRotByProject.get(r.project_id);
      if (!agg) { agg = { tracked: 0, dirty: 0, neverRead: 0 }; docRotByProject.set(r.project_id, agg); }
      agg.tracked += 1;
      if (r.dirty_since) agg.dirty += 1;
      if (r.last_read_at === null) agg.neverRead += 1;
    }
    // Usage telemetry (P1) — registry rows keyed for the two lookups the wall
    // needs: this project's copy first, the global library copy as fallback.
    const usageByProject = new Map<string, Map<string, SkillUsageRow>>();
    const usageGlobal = new Map<string, SkillUsageRow>();
    for (const r of usageRows) {
      if (r.scope === 'project' && r.project_id) {
        let m = usageByProject.get(r.project_id);
        if (!m) { m = new Map(); usageByProject.set(r.project_id, m); }
        m.set(r.name, r);
      } else if (r.scope === 'global') {
        usageGlobal.set(r.name, r);
      }
    }
    // hash → global name, for the "your library already has this content under
    // another name" share-dedup (Brainiac's proposal guardrail, localized).
    const globalByHash = new Map<string, string>();
    for (const r of usageRows) {
      if (r.scope === 'global' && r.content_hash && !r.missing_since) globalByHash.set(r.content_hash, r.name);
    }
    const skillCatalog = new Map<string, { source: string | null; description: string | null }>();
    for (const g of globalSkills) if (!skillCatalog.has(g.name)) skillCatalog.set(g.name, { source: null, description: g.description });
    for (const [pid, list] of projectSkillLists) for (const s of list) if (!skillCatalog.has(s.name)) skillCatalog.set(s.name, { source: pid, description: s.description });
    const installedByProject = new Map(projectSkillLists.map(([pid, list]) => [pid, new Set(list.map((s) => s.name))]));
    // Shared-vs-specific split: a skill counts as SHARED (reused) when its name
    // also exists in the global library or in a sibling project; the rest are
    // specific to that codebase — the split the skills cell + modal render.
    const globalNames = new Set(globalSkills.map((g) => g.name));
    const nameOwners = new Map<string, number>();
    for (const [, list] of projectSkillLists) for (const s of list) nameOwners.set(s.name, (nameOwners.get(s.name) ?? 0) + 1);
    const isShared = (name: string) => globalNames.has(name) || (nameOwners.get(name) ?? 0) > 1;

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
      const installedList = projectSkillLists.find(([pid]) => pid === meta.project_id)?.[1] ?? [];
      const hasSkills = installed.size > 0;
      const reused = [...installed].filter(isShared).length;
      // Usage per installed skill: the project copy's registry row, else the
      // global copy's. Dormancy is Brainiac's age-guarded rule, computed in Rust.
      const projUsage = usageByProject.get(meta.project_id);
      const usageFor = (name: string) => projUsage?.get(name) ?? usageGlobal.get(name);
      const skillUsage: Record<string, { invokes30d: number; lastInvokedAt: string | null; dormant: boolean }> = {};
      let dormant = 0;
      for (const name of installed) {
        const u = usageFor(name);
        if (!u) continue;
        skillUsage[name] = { invokes30d: u.invokes_30d, lastInvokedAt: u.last_invoked_at, dormant: u.dormant };
        if (u.dormant) dormant += 1;
      }
      const skillCounts = { reused, own: installed.size - reused, dormant };
      const evidence = evidenceById.get(meta.project_id) ?? null;
      const skillsToAdd = [...skillCatalog.entries()]
        .filter(([name, info]) => !installed.has(name) && info.source !== meta.project_id)
        .map(([name, info]) => ({ name, source: info.source, description: info.description }));
      // Liveliness of adopt candidates at their SOURCE — a skill used 12× in 30d
      // elsewhere is a better adoption bet than one nobody invokes.
      const catalogUsage: Record<string, { invokes30d: number; lastInvokedAt: string | null }> = {};
      for (const c of skillsToAdd) {
        const u = usageGlobal.get(c.name) ?? (c.source ? usageByProject.get(c.source)?.get(c.name) : undefined);
        if (u) catalogUsage[c.name] = { invokes30d: u.invokes_30d, lastInvokedAt: u.last_invoked_at };
      }
      // Share candidates: this project's skills the global library doesn't have —
      // by name AND by content (an identical library skill under another name
      // means the library already decided; don't re-generalize it).
      const skillsToShare = installedList
        .filter((s) => !globalNames.has(s.name))
        .filter((s) => {
          const hash = projUsage?.get(s.name)?.content_hash;
          return !(hash && globalByHash.has(hash));
        })
        .map((s) => ({ name: s.name, description: s.description }));
      const docRot = docRotByProject.get(meta.project_id);
      rawByProject.set(project.id, { project, meta, hasSkills, skillCounts, skillUsage, catalogUsage, skillsToAdd, skillsToShare, evidence, docRot });
      passports.push(derivePassportFromMetadata(meta, project, { hasSkills, evidence, skillCounts, docRot }));
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

  // Telemetry sweeps (P1 skills + P2 doc rot) — once per mount, then re-derive
  // so fresh counts reach the cells. ORDER MATTERS: the rot scan runs before
  // transcript mining so backfilled doc reads stamp `was_dirty` against real
  // dirty state. Both bounded (rot scan 6h-throttled per project; mining
  // `exhausted` → continue, max 3 rounds) and warn-only: telemetry must never
  // break the wall.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await scanDocRot().catch(silentCatch('usePassportData:docRotScan'));
        for (let i = 0; i < 3; i++) {
          const s = await scanSkillUsage();
          if (cancelled || !s.exhausted) break;
        }
        if (!cancelled) build(false).catch(silentCatch('usePassportData:usageRebuild'));
      } catch (e) {
        silentCatch('usePassportData:skillUsageScan')(e);
      }
    })();
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
