// Registry tab host — owns the workspace matrix data + adopt/use handlers.
// The matrix (RegistryHeatmap) renders library skills × the workspace's
// projects. Handlers:
//   • adopt runs in parallel (each cell tracks its own in-flight state) and is
//     blocked while a Fleet dispatch of that skill is still running there;
//   • use fleet-dispatches the skill in that project's repo;
//   • a skill-name click opens the shared SkillInfoModal (metadata + how to
//     invoke), reachable identically from Overview / Analytics / Registry.
import { useCallback, useMemo, useState } from 'react';

import { installSkill, installSystemSkill } from '@/api/devTools/devTools';
import { spawnSession } from '@/api/fleet/fleet';
import { skillCommand } from '@/features/teams/sub_factory/passport/improve/skillsWorkbenchData';
import { toastCatch } from '@/lib/silentCatch';
import { useToastStore } from '@/stores/toastStore';
import { useTranslation } from '@/i18n/useTranslation';

import { isPresetSkill } from '../../constants/presetSkills';
import { cellKey } from './registryTypes';
import { useSkillsRegistry } from './useSkillsRegistry';
import { RegistryHeatmap } from './RegistryHeatmap';

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full flex items-center justify-center">
      <p className="typo-caption text-foreground/45 text-center max-w-sm">{children}</p>
    </div>
  );
}

export function RegistryTab({ activeProjectId, onOpenInfo }: {
  activeProjectId: string | null;
  onOpenInfo: (skill: string) => void;
}) {
  const { t, tx } = useTranslation();
  const d = t.plugins.dev_tools;
  const [tick, setTick] = useState(0);
  const model = useSkillsRegistry(activeProjectId, tick);
  const [adopting, setAdopting] = useState<Set<string>>(new Set());
  const addToast = useToastStore((s) => s.addToast);

  const rootById = useMemo(() => new Map(model.projects.map((p) => [p.id, p.rootPath])), [model.projects]);

  const onAdopt = useCallback((skill: string, projectId: string) => {
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
  }, [addToast]);

  const onUse = useCallback((skill: string, projectId: string) => {
    const root = rootById.get(projectId);
    if (!root) return;
    void spawnSession(root, [skillCommand(skill, '')])
      .then(() => { addToast(tx(d.skills_registry_dispatched, { skill }), 'success'); setTick((n) => n + 1); })
      .catch(toastCatch('registry use'));
  }, [rootById, addToast, tx, d]);

  if (!model.workspace) {
    return <Hint>{d.skills_registry_no_workspace}</Hint>;
  }
  if (model.projects.length === 0) {
    return <Hint>{d.skills_registry_no_projects}</Hint>;
  }

  return (
    <div className="flex flex-col h-full min-h-0 gap-2.5" data-testid="skills-registry-tab">
      <div className="flex items-center gap-3 flex-shrink-0">
        <span className="typo-label text-foreground/45 truncate">
          <span className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle" style={{ backgroundColor: model.workspace.color }} />
          {tx(d.skills_registry_summary, { name: model.workspace.name, projects: model.projects.length, skills: model.skills.length })}
        </span>
      </div>
      <div className="flex-1 min-h-0">
        <RegistryHeatmap model={model} adopting={adopting} onAdopt={onAdopt} onUse={onUse} onOpenInfo={onOpenInfo} />
      </div>
    </div>
  );
}
