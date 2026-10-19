import { useCallback, useEffect, useMemo, useState } from 'react';
import { useToastStore } from '@/stores/toastStore';
import { useSystemStore } from '@/stores/systemStore';
import * as devApi from '@/api/devTools/devTools';
import type { SkillEntry, SkillInstallPreview } from '@/api/devTools/devTools';
import type { SkillInstallResult } from '@/lib/bindings/SkillInstallResult';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';

/** Which library the browser is showing — the active project's skills, or
 *  the user-global `~/.claude/skills` library. */
export type SkillSource = 'project' | 'global';


const FAVORITES_STORAGE_KEY = 'personas.devtools.skill_favorites';

function readStringArray(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function writeStringArray(key: string, values: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(values));
  } catch (err) { silentCatch("features/plugins/fleet/sub_skills/useSkillData:catch1")(err); }
}

/**
 * Data layer of the fleet Skill Library drawer (its only consumer): the skill
 * list for one source, the search filter, favourites-first ordering, and the
 * cross-repo install + preview calls.
 *
 * It used to also carry a file browser (select skill -> read/edit/save one of
 * its files, plus a recently-opened list) for a dev-tools Skills browser that
 * no longer mounts it; those members had no reader and were removed.
 */
export function useSkillData(initialSource: SkillSource = 'project') {
  const { t } = useTranslation();
  const dt = t.plugins.dev_tools;
  const addToast = useToastStore((s) => s.addToast);
  const activeProjectId = useSystemStore((s) => s.activeProjectId);

  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  // 'project' = active project's .claude/skills; 'global' = ~/.claude/skills.
  // The drawer opens on 'global' (the shared library); the full browser on 'project'.
  const [source, setSource] = useState<SkillSource>(initialSource);

  const [favorites, setFavorites] = useState<Set<string>>(() => new Set(readStringArray(FAVORITES_STORAGE_KEY)));

  const toggleFavorite = useCallback((name: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      writeStringArray(FAVORITES_STORAGE_KEY, Array.from(next));
      return next;
    });
  }, []);

  const isFavorite = useCallback((name: string) => favorites.has(name), [favorites]);

  const fetchSkills = useCallback(async () => {
    setLoading(true);
    try {
      const list = source === 'global'
        ? await devApi.listSkillsGlobal()
        : await devApi.listSkills(activeProjectId);
      setSkills(list);
    } catch {
      addToast(dt.skills_load_failed_toast, 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast, dt, activeProjectId, source]);

  // Install (copy) a skill into a target project's .claude/skills. The source
  // is the browser's current source (active project or the global library).
  // Returns the result so the caller can prompt to overwrite on "exists".
  const installSkill = useCallback(
    async (skillName: string, targetProjectId: string, overwrite: boolean): Promise<SkillInstallResult | null> => {
      try {
        const sourceProjectId = source === 'global' ? null : (activeProjectId ?? null);
        return await devApi.installSkill(skillName, sourceProjectId, targetProjectId, overwrite);
      } catch (err) {
        addToast(err instanceof Error ? err.message : t.plugins.fleet.skill_install_failed, 'error');
        return null;
      }
    },
    [source, activeProjectId, addToast, t],
  );

  // Preview a (re-)install diff before overwriting. Returns null on error (the
  // caller degrades gracefully — a missing preview just hides the summary).
  const previewInstall = useCallback(
    async (skillName: string, targetProjectId: string): Promise<SkillInstallPreview | null> => {
      try {
        const sourceProjectId = source === 'global' ? null : (activeProjectId ?? null);
        return await devApi.previewInstallSkill(skillName, sourceProjectId, targetProjectId);
      } catch (err) {
        silentCatch('features/plugins/fleet/sub_skills/useSkillData:previewInstall')(err);
        return null;
      }
    },
    [source, activeProjectId],
  );

  // Reload when the source or the active project changes.
  useEffect(() => {
    fetchSkills();
  }, [fetchSkills]);

  const filtered = useMemo(() => {
    const matched = search
      ? skills.filter((s) =>
          s.name.toLowerCase().includes(search.toLowerCase()) ||
          (s.description ?? '').toLowerCase().includes(search.toLowerCase())
        )
      : skills;
    // Stable sort: favorites first (alphabetic), then non-favorites (alphabetic by source order).
    return [...matched].sort((a, b) => {
      const aFav = favorites.has(a.name) ? 0 : 1;
      const bFav = favorites.has(b.name) ? 0 : 1;
      if (aFav !== bFav) return aFav - bFav;
      return 0;
    });
  }, [search, skills, favorites]);

  return {
    filtered,
    loading, search, setSearch,
    source, setSource,
    fetchSkills,
    toggleFavorite, isFavorite, installSkill, previewInstall,
  };
}
