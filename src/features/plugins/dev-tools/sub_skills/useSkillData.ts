import { useCallback, useEffect, useMemo, useState } from 'react';
import { useToastStore } from '@/stores/toastStore';
import * as devApi from '@/api/devTools/devTools';
import type { SkillEntry } from '@/api/devTools/devTools';
import { useTranslation } from '@/i18n/useTranslation';

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

  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

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
      const list = await devApi.listSkills();
      setSkills(list);
    } catch {
      addToast(dt.skills_load_failed_toast, 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast, dt]);

  useEffect(() => { fetchSkills(); }, [fetchSkills]);

  const loadFile = useCallback(async (skill: SkillEntry, fileName: string) => {
    setFileLoading(true);
    setEditing(false);
    setLoadFailed(false);
    try {
      const result = await devApi.readSkillFile(skill.name, fileName);
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
  }, [addToast, dt, tx]);

  const selectSkill = useCallback((skill: SkillEntry) => {
    setSelectedSkill(skill);
    setActiveFile('SKILL.md');
    loadFile(skill, 'SKILL.md');
  }, [loadFile]);

  const switchFile = useCallback((fileName: string) => {
    if (!selectedSkill) return;
    setActiveFile(fileName);
    loadFile(selectedSkill, fileName);
  }, [selectedSkill, loadFile]);

  const save = useCallback(async () => {
    if (!selectedSkill) return;
    setSaving(true);
    try {
      await devApi.writeSkillFile(selectedSkill.name, activeFile, editContent);
      setFileContent(editContent);
      setEditing(false);
      addToast(tx(dt.skills_save_success_toast, { skill: selectedSkill.name, file: activeFile }), 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : dt.skills_save_failed_toast, 'error');
    } finally {
      setSaving(false);
    }
  }, [selectedSkill, activeFile, editContent, addToast, dt, tx]);

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

  const filtered = useMemo(() => (search
    ? skills.filter((s) =>
        s.name.toLowerCase().includes(search.toLowerCase()) ||
        (s.description ?? '').toLowerCase().includes(search.toLowerCase())
      )
    : skills), [search, skills]);

  const skillFiles = useMemo(() => (selectedSkill
    ? ['SKILL.md', ...selectedSkill.referenceFiles]
    : []), [selectedSkill]);

  return {
    skills, filtered,
    loading, search, setSearch,
    selectedSkill, activeFile, fileContent, editContent, setEditContent,
    editing, setEditing, saving, fileLoading, loadFailed,
    skillFiles,
    fetchSkills, selectSkill, switchFile, save, cancelEdit, clearSelection,
  };
}

export type SkillData = ReturnType<typeof useSkillData>;
