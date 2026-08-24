// Shared Launch-tab affordances: the adopt confirmation flow (reuses the
// Skills-Manager `SkillActionConfirm` modal, RegistryTab-style) and the
// launch-with-feedback wrapper that surfaces the "handed to Athena" toast
// through the app's shared toast door. Hoisted here so every Launch variant
// shares one implementation instead of four.
import { useCallback, useMemo, useState, type ReactNode } from 'react';

import { useTranslation } from '@/i18n/useTranslation';
import { useToastStore } from '@/stores/toastStore';

import { isPresetSkill } from '../../constants/presetSkills';
import { SkillActionConfirm } from '../SkillActionConfirm';
import type { ProjectLaunchCell, SkillLaunchData } from './launchTypes';

export function useAdoptConfirm(data: SkillLaunchData): {
  /** Open the confirm dialog for this cell (needs_adopt only). */
  requestAdopt: (cell: ProjectLaunchCell) => void;
  /** Render this once near the variant root. */
  adoptDialog: ReactNode;
} {
  const [pendingId, setPendingId] = useState<string | null>(null);

  // Re-resolve from live cells so `busy` tracks the in-flight adopt rather
  // than a stale snapshot taken when the dialog opened.
  const pending = useMemo(
    () => (pendingId ? data.cells.find((c) => c.project.id === pendingId) ?? null : null),
    [data.cells, pendingId],
  );

  const skill = data.selectedSkill;
  const entry = skill ? data.skills.find((s) => s.name === skill) ?? null : null;

  const requestAdopt = useCallback((cell: ProjectLaunchCell) => {
    setPendingId(cell.project.id);
  }, []);

  const adoptDialog = pending && skill ? (
    <SkillActionConfirm
      kind="adopt"
      skill={{ name: skill, description: entry?.description ?? null }}
      projectName={pending.project.name}
      busy={pending.adopting}
      preset={isPresetSkill(skill)}
      onConfirm={() => { setPendingId(null); void data.adopt(pending); }}
      onClose={() => setPendingId(null)}
    />
  ) : null;

  return { requestAdopt, adoptDialog };
}

/**
 * Launch a ready cell and surface `launch_sent_to_athena` via the shared
 * toast store (the launch itself is a sync hand-off to the companion chat).
 */
export function useLaunchWithFeedback(data: SkillLaunchData): (cell: ProjectLaunchCell) => void {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  return useCallback((cell: ProjectLaunchCell) => {
    if (cell.status !== 'ready') return;
    data.launch(cell);
    addToast(t.plugins.dev_tools.launch_sent_to_athena, 'success');
  }, [data, addToast, t]);
}
