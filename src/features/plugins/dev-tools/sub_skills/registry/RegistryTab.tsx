// Registry host — owns the matrix data + the adopt/use handlers for BOTH axes.
//
//   · axis="workspace" (default) — library skills × the workspace's projects.
//     An empty cell adopts. Dev Tools → Skills → Registry.
//   · axis="project" — one project's installed skills × its context groups.
//     Every cell dispatches, scoped to that group. The Mastermind Skills modal.
//
// Adopt and dispatch both go through `SkillActionConfirm`, the SAME modal the
// Overview board uses for its row actions: the registry used to fire an install
// the instant a cell was clicked, which made a mis-click a real Dev-runner task
// with no way back. The confirm also carries the args field for a dispatch, so
// running a skill from the matrix is as configurable as running it from the
// board. An in-flight adoption locks its cell (cellStatus → 'adopting').
import { useCallback, useMemo, useState } from 'react';

import { installSkill, installSystemSkill } from '@/api/devTools/devTools';
import { spawnSession } from '@/api/fleet/fleet';
import { skillCommand } from '@/features/teams/sub_factory/passport/improve/skillsWorkbenchData';
import { toastCatch } from '@/lib/silentCatch';
import { useToastStore } from '@/stores/toastStore';
import { useTranslation } from '@/i18n/useTranslation';

import { isPresetSkill } from '../../constants/presetSkills';
import { SkillActionConfirm } from '../SkillActionConfirm';
import { cellKey, type RegistryMode } from './registryTypes';
import { useProjectRegistry } from './useProjectRegistry';
import { useSkillsRegistry } from './useSkillsRegistry';
import { RegistryGhosts } from './RegistryHeatmapCells';
import { RegistryHeatmap } from './RegistryHeatmap';

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full flex items-center justify-center">
      <p className="typo-caption text-foreground/45 text-center max-w-sm">{children}</p>
    </div>
  );
}

/** What the operator is confirming. `columnId` is a project in workspace mode
 *  and a context group in project mode. */
interface Pending {
  kind: 'adopt' | 'use';
  skill: string;
  columnId: string;
  columnName: string;
}

export function RegistryTab({ activeProjectId, axis = 'workspace', onOpenInfo }: {
  activeProjectId: string | null;
  /** Column axis — see the module comment. */
  axis?: RegistryMode;
  onOpenInfo: (skill: string) => void;
}) {
  const { t, tx } = useTranslation();
  const d = t.plugins.dev_tools;
  const [tick, setTick] = useState(0);
  // Both hooks are called unconditionally (rules-of-hooks); the inactive one is
  // passed a null project so it never fetches.
  const workspaceModel = useSkillsRegistry(axis === 'workspace' ? activeProjectId : null, tick);
  const projectModel = useProjectRegistry(axis === 'project' ? activeProjectId : null, tick);
  const model = axis === 'project' ? projectModel : workspaceModel;
  const [adopting, setAdopting] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<Pending | null>(null);
  const addToast = useToastStore((s) => s.addToast);

  const columnById = useMemo(() => new Map(model.columns.map((c) => [c.id, c])), [model.columns]);
  const skillByName = useMemo(() => new Map(model.skills.map((s) => [s.name, s])), [model.skills]);

  const runAdopt = useCallback((skill: string, projectId: string) => {
    const key = cellKey(skill, projectId);
    let started = false;
    setAdopting((prev) => {
      if (prev.has(key)) return prev;
      started = true;
      const next = new Set(prev); next.add(key); return next;
    });
    if (!started) return;
    void (async () => {
      try {
        if (isPresetSkill(skill)) await installSystemSkill(skill, projectId, false);
        else await installSkill(skill, null, projectId, false);
        addToast(tx(d.skills_registry_adopted, { skill }), 'success');
        setTick((n) => n + 1);
      } catch (err) {
        toastCatch('registry adopt')(err);
      } finally {
        setAdopting((prev) => { const next = new Set(prev); next.delete(key); return next; });
      }
    })();
  }, [addToast, tx, d]);

  /**
   * Dispatch the skill in the column's repo. In project mode the column IS a
   * context group, so its name rides along as a trailing positional — the same
   * "preset terminal input" convention the Overview board's Use dialog uses to
   * carry a context choice.
   */
  const runUse = useCallback((skill: string, columnId: string, args: string) => {
    const column = columnById.get(columnId);
    if (!column?.rootPath) return;
    const full = axis === 'project' ? [args, column.name].filter(Boolean).join(' ') : args;
    // No tick bump here: a dispatch only changes which cells are RUNNING, and
    // the model hooks watch sessions on their own decoupled poll — re-fetching
    // the whole listSkills fan-out for a run lock was the freeze pattern.
    void spawnSession(column.rootPath, [skillCommand(skill, full)])
      .then(() => { addToast(tx(d.skills_registry_dispatched, { skill }), 'success'); })
      .catch(toastCatch('registry use'));
  }, [columnById, axis, addToast, tx, d]);

  const confirm = (args: string) => {
    if (!pending) return;
    if (pending.kind === 'adopt') runAdopt(pending.skill, pending.columnId);
    else runUse(pending.skill, pending.columnId, args);
    setPending(null);
  };

  // Stable handlers so the memoized RegistryRow leaves don't re-render on
  // unrelated host state (pending/adopting churn).
  const openAdopt = useCallback(
    (skill: string, columnId: string) => setPending({ kind: 'adopt', skill, columnId, columnName: columnById.get(columnId)?.name ?? '' }),
    [columnById],
  );
  const openUse = useCallback(
    (skill: string, columnId: string) => setPending({ kind: 'use', skill, columnId, columnName: columnById.get(columnId)?.name ?? '' }),
    [columnById],
  );

  if (axis === 'workspace' && !model.header) return <Hint>{d.skills_registry_no_workspace}</Hint>;
  if (model.columns.length === 0) {
    // Cold load: the column axis is still being fetched (project mode derives
    // it from contexts) — a calm ghost, never the settled "no data" hint.
    if (model.loading) return <RegistryGhosts columns={6} />;
    return <Hint>{axis === 'project' ? d.skills_registry_no_contexts : d.skills_registry_no_projects}</Hint>;
  }

  const pendingSkill = pending ? skillByName.get(pending.skill) : undefined;

  return (
    <div className="flex flex-col h-full min-h-0 gap-2.5" data-testid={`skills-registry-${axis}`}>
      <div className="flex items-center gap-3 flex-shrink-0">
        <span className="typo-label text-foreground/45 truncate">
          <span className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle" style={{ backgroundColor: model.header?.color ?? 'var(--primary)' }} />
          {axis === 'project'
            ? tx(d.skills_registry_project_summary, { name: model.header?.name ?? '', groups: model.columns.length, skills: model.skills.length })
            : tx(d.skills_registry_summary, { name: model.header?.name ?? '', projects: model.columns.length, skills: model.skills.length })}
        </span>
      </div>
      <div className="flex-1 min-h-0">
        <RegistryHeatmap
          model={model}
          adopting={adopting}
          onAdopt={openAdopt}
          onUse={openUse}
          onOpenInfo={onOpenInfo}
        />
      </div>

      {pending && (
        <SkillActionConfirm
          kind={pending.kind}
          skill={{ name: pending.skill, description: pendingSkill?.description ?? null }}
          projectName={pending.columnName}
          busy={adopting.has(cellKey(pending.skill, pending.columnId))}
          preset={isPresetSkill(pending.skill)}
          onConfirm={confirm}
          onClose={() => setPending(null)}
        />
      )}
    </div>
  );
}
