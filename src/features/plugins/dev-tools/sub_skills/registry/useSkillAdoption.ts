// Adopt a library skill into a project — the one adoption door both matrix
// hosts share: the Registry tab (behind its confirm modal) and the dispatch
// dock's skill picker (an empty cell installs, then loads the console).
// Extracted 2026-09-17 so the preset-vs-custom install split and the
// per-cell in-flight lock live in one place.
import { useCallback, useState } from 'react';

import { installSkill, installSystemSkill } from '@/api/devTools/devTools';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import { useToastStore } from '@/stores/toastStore';

import { isPresetSkill } from '../../constants/presetSkills';
import { cellKey } from './registryTypes';

export interface SkillAdoption {
  /** In-flight adoptions, keyed `${skill}|${projectId}` (the heatmap's lock). */
  adopting: Set<string>;
  adopt: (skill: string, projectId: string) => void;
}

/** `onAdopted` fires after a successful install — refresh the matrix there. */
export function useSkillAdoption(onAdopted?: (skill: string, projectId: string) => void): SkillAdoption {
  const { t, tx } = useTranslation();
  const d = t.plugins.dev_tools;
  const addToast = useToastStore((s) => s.addToast);
  const [adopting, setAdopting] = useState<Set<string>>(new Set());

  const adopt = useCallback((skill: string, projectId: string) => {
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
        onAdopted?.(skill, projectId);
      } catch (err) {
        toastCatch('registry adopt')(err);
      } finally {
        setAdopting((prev) => { const next = new Set(prev); next.delete(key); return next; });
      }
    })();
  }, [addToast, tx, d, onAdopted]);

  return { adopting, adopt };
}
