// Registry tab host — owns the workspace matrix data + adopt/use handlers and
// (during prototyping) a throwaway switcher between directional variants. Every
// variant renders the same model and shares these handlers:
//   • adopt runs in parallel (each cell tracks its own in-flight state) and is
//     blocked while a Fleet dispatch of that skill is still running there;
//   • use fleet-dispatches the skill in that project's repo.
//
// PROTOTYPE: switcher + variants are removed at consolidation (Phase 5).
import { useCallback, useMemo, useState } from 'react';

import { installSkill, installSystemSkill } from '@/api/devTools/devTools';
import { spawnSession } from '@/api/fleet/fleet';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { skillCommand } from '@/features/teams/sub_factory/passport/improve/skillsWorkbenchData';
import { toastCatch } from '@/lib/silentCatch';
import { useToastStore } from '@/stores/toastStore';

import { isPresetSkill } from '../../constants/presetSkills';
import { cellKey } from './registryTypes';
import { useSkillsRegistry } from './useSkillsRegistry';
import { SkillsRegistryHeatmap } from './SkillsRegistryVariantHeatmap';
import { SkillsRegistryRail } from './SkillsRegistryVariantRail';
import { SkillsRegistryMatrix } from './SkillsRegistryVariantMatrix';

type Variant = 'heatmap' | 'rail' | 'matrix';

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full flex items-center justify-center">
      <p className="typo-caption text-foreground/45 text-center max-w-sm">{children}</p>
    </div>
  );
}

export function RegistryTab({ activeProjectId }: { activeProjectId: string | null }) {
  const [tick, setTick] = useState(0);
  const model = useSkillsRegistry(activeProjectId, tick);
  const [adopting, setAdopting] = useState<Set<string>>(new Set());
  const [variant, setVariant] = useState<Variant>('heatmap');
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
        addToast(`${skill} adopted`, 'success');
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
      .then(() => { addToast(`Dispatched ${skill}`, 'success'); setTick((n) => n + 1); })
      .catch(toastCatch('registry use'));
  }, [rootById, addToast]);

  if (!model.workspace) {
    return <Hint>Assign this project to a workspace to see its skills registry.</Hint>;
  }
  if (model.projects.length === 0) {
    return <Hint>This workspace has no projects yet — add one to populate the coverage matrix.</Hint>;
  }

  const props = { model, adopting, onAdopt, onUse };
  return (
    <div className="flex flex-col h-full min-h-0 gap-3" data-testid="skills-registry-tab">
      {/* PROTOTYPE switcher — removed at consolidation. */}
      <div className="flex items-center gap-3 flex-shrink-0">
        <SegmentedTabs
          tabs={[
            { id: 'heatmap', label: 'Heatmap' },
            { id: 'rail', label: 'Rail' },
            { id: 'matrix', label: 'Matrix' },
          ]}
          activeTab={variant}
          onTabChange={(v) => setVariant(v as Variant)}
          variant="pill"
          size="sm"
          fullWidth={false}
          ariaLabel="Registry layout variant"
        />
        <span className="typo-label text-foreground/40 truncate">
          <span className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle" style={{ backgroundColor: model.workspace.color }} />
          {model.workspace.name} · {model.projects.length} projects · {model.skills.length} skills
        </span>
      </div>
      <div className="flex-1 min-h-0">
        {variant === 'heatmap' && <SkillsRegistryHeatmap {...props} />}
        {variant === 'rail' && <SkillsRegistryRail {...props} />}
        {variant === 'matrix' && <SkillsRegistryMatrix {...props} />}
      </div>
    </div>
  );
}
