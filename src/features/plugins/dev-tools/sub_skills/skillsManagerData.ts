// Skills Manager data spine — one hook behind both prototype variants.
//
// Reuses the unified skills-workbench hook (adopt/share Dev-runner ops,
// installed skills with usage) and adds the manager's extras: the FULL
// workspace library (not just adoptables), per-skill context coverage from
// the Memory Ledger (30d), and the memory-binding switcher (patches the
// skill's SKILL.md frontmatter in place).
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  getSkillUsageOverview, listSkills, listSkillsGlobal, memoryCoverage, memorySkillCoverage,
  readSkillFile, writeSkillFile,
  type SkillCoverageRow, type SkillEntry, type SkillUsageRow,
} from '@/api/devTools/devTools';
import { useSkillsWorkbench, type SkillsWorkbench } from '@/features/teams/sub_factory/passport/improve/skillsWorkbenchData';
import { silentCatch } from '@/lib/silentCatch';
import { useToastStore } from '@/stores/toastStore';

export type MemoryBinding = 'project' | 'vault' | 'none';

/** Cycle order for the memory-binding switch (point 4): internal → obsidian →
 *  none → internal. Undeclared behaves as none. */
export function nextBinding(current: string | null | undefined): MemoryBinding {
  if (current === 'project') return 'vault';
  if (current === 'vault') return 'none';
  return 'project';
}

export interface SkillsManagerData {
  /** The unified workbench (adopt/share ops, installed skills, counts) — null
   *  while the improve engine has no row for the project yet. */
  wb: SkillsWorkbench | null;
  /** Full workspace library (~/.claude/skills), name-asc, with meta. */
  workspaceSkills: SkillEntry[];
  /** The active project's installed skills, name-asc, with meta — the
   *  manager's own fetch (re-reads after a memory switch; the workbench hook
   *  only refetches per slug). */
  projectSkills: SkillEntry[];
  /** Names installed in the active project (workspace rows dim when present). */
  installedNames: Set<string>;
  /** skill name → coverage row (30d, attributed nodes). */
  coverageBySkill: Map<string, SkillCoverageRow>;
  /** Transcript-mined usage — workspace (global-scope) rows by skill name. */
  usageGlobal: Map<string, SkillUsageRow>;
  /** Transcript-mined usage — the active project's rows by skill name. */
  usageProject: Map<string, SkillUsageRow>;
  /** Coverage denominator — the project's total dev_contexts. */
  totalContexts: number;
  /** Patch a skill's `memory:` frontmatter (null projectId = workspace copy). */
  switchMemory: (skillName: string, projectId: string | null, next: MemoryBinding) => Promise<void>;
  /** Bump after a switch so lists re-derive. */
  refreshTick: number;
}

/** Patch (or insert) the `memory:` line inside SKILL.md frontmatter. Tries
 *  SKILL.md then skill.md (both casings live in the wild — kpi-sim uses the
 *  lower one). Returns the file name patched. */
async function patchMemoryFrontmatter(skillName: string, projectId: string | null, next: MemoryBinding): Promise<void> {
  let fileName = 'SKILL.md';
  let content: string;
  try {
    content = (await readSkillFile(skillName, fileName, projectId)).content;
  } catch {
    fileName = 'skill.md';
    content = (await readSkillFile(skillName, fileName, projectId)).content;
  }
  let updated: string;
  if (/^memory:.*$/m.test(content)) {
    updated = content.replace(/^memory:.*$/m, `memory: ${next}`);
  } else if (content.trimStart().startsWith('---')) {
    updated = content.replace(/^(---\r?\n(?:name:[^\n]*\r?\n)?)/, (m) => `${m}memory: ${next}\n`);
  } else {
    updated = `---\nmemory: ${next}\n---\n\n${content}`;
  }
  await writeSkillFile(skillName, fileName, updated, projectId);
}

export function useSkillsManagerData(activeProjectId: string | null): SkillsManagerData {
  const addToast = useToastStore((s) => s.addToast);
  const wb = useSkillsWorkbench(activeProjectId ?? '');
  const [workspaceSkills, setWorkspaceSkills] = useState<SkillEntry[]>([]);
  const [projectSkills, setProjectSkills] = useState<SkillEntry[]>([]);
  const [coverage, setCoverage] = useState<SkillCoverageRow[]>([]);
  const [totalContexts, setTotalContexts] = useState(0);
  const [usageRows, setUsageRows] = useState<SkillUsageRow[]>([]);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let alive = true;
    getSkillUsageOverview()
      .then((rows) => { if (alive) setUsageRows(rows); })
      .catch(silentCatch('skillsManager usage overview'));
    return () => { alive = false; };
  }, [refreshTick]);

  useEffect(() => {
    let alive = true;
    listSkillsGlobal()
      .then((rows) => { if (alive) setWorkspaceSkills([...rows].sort((a, b) => a.name.localeCompare(b.name))); })
      .catch(silentCatch('skillsManager global list'));
    return () => { alive = false; };
  }, [refreshTick]);

  useEffect(() => {
    if (!activeProjectId) { setCoverage([]); setTotalContexts(0); setProjectSkills([]); return; }
    let alive = true;
    listSkills(activeProjectId)
      .then((rows) => { if (alive) setProjectSkills([...rows].sort((a, b) => a.name.localeCompare(b.name))); })
      .catch(silentCatch('skillsManager project list'));
    memorySkillCoverage(activeProjectId)
      .then((rows) => { if (alive) setCoverage(rows); })
      .catch(silentCatch('skillsManager coverage'));
    memoryCoverage(activeProjectId)
      .then((c) => { if (alive) setTotalContexts(c.contexts); })
      .catch(silentCatch('skillsManager contexts total'));
    return () => { alive = false; };
  }, [activeProjectId, refreshTick]);

  const coverageBySkill = useMemo(
    () => new Map(coverage.map((r) => [r.skill, r])),
    [coverage],
  );
  const usageGlobal = useMemo(
    () => new Map(usageRows.filter((r) => r.scope === 'global').map((r) => [r.name, r])),
    [usageRows],
  );
  const usageProject = useMemo(
    () => new Map(
      usageRows
        .filter((r) => r.scope === 'project' && r.project_id === activeProjectId)
        .map((r) => [r.name, r]),
    ),
    [usageRows, activeProjectId],
  );
  const installedNames = useMemo(
    () => new Set(projectSkills.map((s) => s.name)),
    [projectSkills],
  );

  const switchMemory = useCallback(async (skillName: string, projectId: string | null, next: MemoryBinding) => {
    try {
      await patchMemoryFrontmatter(skillName, projectId, next);
      addToast(`“${skillName}” memory → ${next === 'project' ? 'internal' : next === 'vault' ? 'Obsidian' : 'none'}`, 'success');
      setRefreshTick((t) => t + 1);
    } catch (e) {
      addToast('Couldn’t update the skill’s memory binding', 'error');
      silentCatch('skillsManager memory switch')(e);
    }
  }, [addToast]);

  return { wb, workspaceSkills, projectSkills, installedNames, coverageBySkill, usageGlobal, usageProject, totalContexts, switchMemory, refreshTick };
}
