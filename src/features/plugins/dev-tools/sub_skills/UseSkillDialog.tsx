// "Use skill" dialog — the extended dispatch confirmation for a project skill.
// Beyond the description + args of the plain confirm, it lets the operator
// choose WHERE the run goes (Fleet background session vs an external CMD) and,
// for context-tracked skills, WHICH context(s) to run against (a specific one,
// the recommended [least-covered] one, or all of them).
//
// ── PROTOTYPE SCAFFOLD (/prototype, throwaway) ──────────────────────────────
// Three directional variants behind a tab switcher — the host owns the shared
// choice state + data; each variant lays the choices out differently.
//   · Segmented — compact form, segmented toggles
//   · Cards     — decision-forward selectable tiles
//   · Composer  — terminal-centric, the command line is the hero
import { useEffect, useMemo, useState } from 'react';

import { listContexts, memorySkillContexts, type DevContext } from '@/api/devTools/devTools';
import { BaseModal } from '@/features/shared/components/modals';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { skillCommand } from '@/features/teams/sub_factory/passport/improve/skillsWorkbenchData';
import { silentCatch } from '@/lib/silentCatch';

import { UseSkillSegmented } from './UseSkillVariantSegmented';
import { UseSkillCards } from './UseSkillVariantCards';
import { UseSkillComposer } from './UseSkillVariantComposer';

export type DispatchTarget = 'fleet' | 'cmd';
export type ContextMode = 'specific' | 'recommended' | 'all';

/** The operator's assembled choice, handed to the caller on confirm. */
export interface UseSkillChoice {
  /** Free-text args (excludes any context term — see `contexts`). */
  args: string;
  target: DispatchTarget;
  /** Context names to run against: [] = none/untracked, [one] = specific or
   *  recommended, [all] = every context (one dispatch each). */
  contexts: string[];
}

/** Identical props every variant body receives from the host. */
export interface UseSkillVariantProps {
  skill: { name: string; description: string | null };
  projectName: string;
  tracked: boolean;
  contexts: DevContext[];
  /** Least-covered context name (30d) — the "recommended" preset; null when
   *  the project has no contexts. */
  recommendedName: string | null;
  loadingContexts: boolean;
  // controlled choice state (owned by the host)
  args: string; setArgs: (s: string) => void;
  target: DispatchTarget; setTarget: (t: DispatchTarget) => void;
  mode: ContextMode; setMode: (m: ContextMode) => void;
  contextId: string | null; setContextId: (id: string | null) => void;
  busy: boolean;
  /** The exact `/skill …` the current choice will run (single context, or the
   *  first of an "all" batch) — variants render it as a live preview. */
  preview: string;
  onConfirm: () => void;
  onClose: () => void;
}

type VariantId = 'segmented' | 'cards' | 'composer';

export function UseSkillDialog({ skill, projectId, projectName, tracked, busy, onConfirm, onClose }: {
  skill: { name: string; description: string | null };
  projectId: string;
  projectName: string;
  tracked: boolean;
  busy: boolean;
  /** Fires with the assembled choice; the caller routes Fleet/CMD + contexts. */
  onConfirm: (choice: UseSkillChoice) => void;
  onClose: () => void;
}) {
  const [variant, setVariant] = useState<VariantId>('segmented');
  const [args, setArgs] = useState('');
  const [target, setTarget] = useState<DispatchTarget>('fleet');
  const [mode, setMode] = useState<ContextMode>(tracked ? 'recommended' : 'specific');
  const [contextId, setContextId] = useState<string | null>(null);
  const [contexts, setContexts] = useState<DevContext[]>([]);
  const [recommendedName, setRecommendedName] = useState<string | null>(null);
  const [loadingContexts, setLoadingContexts] = useState(tracked);

  // Contexts + the recommended (least-covered) one — only for tracked skills.
  useEffect(() => {
    if (!tracked) return;
    let alive = true;
    setLoadingContexts(true);
    Promise.all([
      listContexts(projectId).catch((e) => { silentCatch('useSkill contexts')(e); return [] as DevContext[]; }),
      memorySkillContexts(projectId, skill.name).catch((e) => { silentCatch('useSkill skill contexts')(e); return []; }),
    ]).then(([ctx, cov]) => {
      if (!alive) return;
      const sorted = [...ctx].sort((a, b) => a.name.localeCompare(b.name));
      setContexts(sorted);
      // Recommended = the fresh-node-poorest context (most in need of work).
      const rec = [...cov].sort((a, b) => a.freshNodes - b.freshNodes || a.name.localeCompare(b.name))[0];
      setRecommendedName(rec?.name ?? sorted[0]?.name ?? null);
      setContextId(sorted[0]?.id ?? null);
      setLoadingContexts(false);
    });
    return () => { alive = false; };
  }, [tracked, projectId, skill.name]);

  // The context term folded into the run, per mode.
  const chosenContexts = useMemo((): string[] => {
    if (!tracked) return [];
    if (mode === 'all') return contexts.map((c) => c.name);
    if (mode === 'recommended') return recommendedName ? [recommendedName] : [];
    const c = contexts.find((x) => x.id === contextId);
    return c ? [c.name] : [];
  }, [tracked, mode, contexts, recommendedName, contextId]);

  // Preview: args plus the context term (skills receive the context as a
  // trailing argument — a "preset terminal input", not a formal flag).
  const previewArgs = useMemo(() => {
    const first = chosenContexts[0];
    return [args.trim(), first].filter(Boolean).join(' ');
  }, [args, chosenContexts]);
  const preview = skillCommand(skill.name, previewArgs);

  const confirm = () => onConfirm({ args: args.trim(), target, contexts: chosenContexts });

  const shared: UseSkillVariantProps = {
    skill, projectName, tracked, contexts, recommendedName, loadingContexts,
    args, setArgs, target, setTarget, mode, setMode, contextId, setContextId,
    busy, preview, onConfirm: confirm, onClose,
  };
  const Body = variant === 'segmented' ? UseSkillSegmented : variant === 'cards' ? UseSkillCards : UseSkillComposer;

  return (
    <BaseModal isOpen onClose={onClose} titleId="use-skill-title" size="md" portal staggerChildren={false}>
      <span id="use-skill-title" className="sr-only">{skill.name}</span>
      {/* throwaway A/B switcher */}
      <div className="flex justify-center pt-2.5 pb-1">
        <SegmentedTabs
          tabs={[{ id: 'segmented', label: 'Segmented' }, { id: 'cards', label: 'Cards' }, { id: 'composer', label: 'Composer' }]}
          activeTab={variant}
          onTabChange={setVariant}
          variant="segment"
          size="sm"
          fullWidth={false}
          ariaLabel="Use-skill dialog variant"
        />
      </div>
      <Body {...shared} />
    </BaseModal>
  );
}
