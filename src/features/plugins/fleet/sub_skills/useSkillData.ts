import { useCallback, useEffect, useMemo, useState } from 'react';
import { useToastStore } from '@/stores/toastStore';
import { useSystemStore } from '@/stores/systemStore';
import * as devApi from '@/api/devTools/devTools';
import type { SkillEntry } from '@/api/devTools/devTools';
import type { SkillInstallResult } from '@/lib/bindings/SkillInstallResult';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';

/** Which library the browser is showing — the active project's skills, or
 *  the user-global `~/.claude/skills` library. */
export type SkillSource = 'project' | 'global';


const FAVORITES_STORAGE_KEY = 'personas.devtools.skill_favorites';
const RECENT_STORAGE_KEY = 'personas.devtools.skill_recent';
const MAX_RECENT = 5;

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
 * Single source of truth for the dev-tools Skills browser data layer.
 * Holds the skill list, search filter, selected skill + file, content +
 * edit buffer, and the read/save calls. Every variant of the browser
 * consumes this hook so the file-buffer state survives variant switching.
 */
export function useSkillData() {
  const { t, tx } = useTranslation();
  const dt = t.plugins.dev_tools;
  const addToast = useToastStore((s) => s.addToast);
  const activeProjectId = useSystemStore((s) => s.activeProjectId);

  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  // 'project' = active project's .claude/skills; 'global' = ~/.claude/skills.
  const [source, setSource] = useState<SkillSource>('project');

  const [favorites, setFavorites] = useState<Set<string>>(() => new Set(readStringArray(FAVORITES_STORAGE_KEY)));
  const [recentlyOpened, setRecentlyOpened] = useState<string[]>(() => readStringArray(RECENT_STORAGE_KEY));

  const toggleFavorite = useCallback((name: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      writeStringArray(FAVORITES_STORAGE_KEY, Array.from(next));
      return next;
    });
  }, []);

  const isFavorite = useCallback((name: string) => favorites.has(name), [favorites]);

  const pushRecent = useCallback((name: string) => {
    setRecentlyOpened((prev) => {
      const next = [name, ...prev.filter((n) => n !== name)].slice(0, MAX_RECENT);
      writeStringArray(RECENT_STORAGE_KEY, next);
      return next;
    });
  }, []);

  const [selectedSkill, setSelectedSkill] = useState<SkillEntry | null>(null);
  const [activeFile, setActiveFile] = useState<string>('SKILL.md');
  const [fileContent, setFileContent] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fileLoading, setFileLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

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

  // Reset selection + reload when the active project changes — skills come
  // from the new project's .claude/skills directory, so the previous
  // selection is unlikely to still be valid.
  useEffect(() => {
    setSelectedSkill(null);
    setActiveFile('SKILL.md');
    setFileContent('');
    setEditContent('');
    setEditing(false);
    setLoadFailed(false);
    fetchSkills();
  }, [fetchSkills]);

  const loadFile = useCallback(async (skill: SkillEntry, fileName: string) => {
    setFileLoading(true);
    setEditing(false);
    setLoadFailed(false);
    try {
      const result = await devApi.readSkillFile(skill.name, fileName, activeProjectId);
      setFileContent(result.content);
      setEditContent(result.content);
    } catch {
      setFileContent('');
      setEditContent('');
      setLoadFailed(true);
      addToast(tx(dt.skills_read_failed_toast, { skill: skill.name, file: fileName }), 'error');
    } finally {
      setFileLoading(false);
    }
  }, [addToast, dt, tx, activeProjectId]);

  const selectSkill = useCallback((skill: SkillEntry) => {
    setSelectedSkill(skill);
    setActiveFile('SKILL.md');
    loadFile(skill, 'SKILL.md');
    pushRecent(skill.name);
  }, [loadFile, pushRecent]);

  const switchFile = useCallback((fileName: string) => {
    if (!selectedSkill) return;
    setActiveFile(fileName);
    loadFile(selectedSkill, fileName);
  }, [selectedSkill, loadFile]);

  const save = useCallback(async () => {
    if (!selectedSkill) return;
    setSaving(true);
    try {
      await devApi.writeSkillFile(selectedSkill.name, activeFile, editContent, activeProjectId);
      setFileContent(editContent);
      setEditing(false);
      addToast(tx(dt.skills_save_success_toast, { skill: selectedSkill.name, file: activeFile }), 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : dt.skills_save_failed_toast, 'error');
    } finally {
      setSaving(false);
    }
  }, [selectedSkill, activeFile, editContent, addToast, dt, tx, activeProjectId]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
    setEditContent(fileContent);
  }, [fileContent]);

  const clearSelection = useCallback(() => {
    setSelectedSkill(null);
    setActiveFile('SKILL.md');
    setFileContent('');
    setEditContent('');
    setEditing(false);
    setLoadFailed(false);
  }, []);

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

  // Resolve recently-opened names back to SkillEntry rows (filter out any
  // names that no longer exist after a refresh).
  const recentSkills = useMemo(() => {
    const byName = new Map(skills.map((s) => [s.name, s]));
    return recentlyOpened.map((n) => byName.get(n)).filter((s): s is SkillEntry => Boolean(s));
  }, [recentlyOpened, skills]);

  const skillFiles = useMemo(() => (selectedSkill
    ? ['SKILL.md', ...selectedSkill.referenceFiles]
    : []), [selectedSkill]);

  return {
    skills, filtered, recentSkills,
    loading, search, setSearch,
    source, setSource,
    selectedSkill, activeFile, fileContent, editContent, setEditContent,
    editing, setEditing, saving, fileLoading, loadFailed,
    skillFiles,
    fetchSkills, selectSkill, switchFile, save, cancelEdit, clearSelection,
    toggleFavorite, isFavorite, installSkill,
  };
}

export type SkillData = ReturnType<typeof useSkillData>;
