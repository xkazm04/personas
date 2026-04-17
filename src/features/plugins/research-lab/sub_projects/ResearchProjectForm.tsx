import { useState } from 'react';
import { FolderOpen, X } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import { ResearchLabFormModal } from '../_shared/ResearchLabFormModal';
import { TextField, TextAreaField, SelectField, Field } from '../_shared/FormField';
import { DOMAINS, domainLabel, type Domain } from '../_shared/tokens';
import type { ResearchProject } from '@/api/researchLab/researchLab';

interface Props {
  onClose: () => void;
  /** If provided, the modal edits this project instead of creating a new one. */
  editing?: ResearchProject;
}

export default function ResearchProjectForm({ onClose, editing }: Props) {
  const { t } = useTranslation();
  const createProject = useSystemStore((s) => s.createResearchProject);
  const updateProject = useSystemStore((s) => s.updateResearchProject);
  const setActiveProject = useSystemStore((s) => s.setActiveResearchProject);

  const [name, setName] = useState(editing?.name ?? '');
  const [description, setDescription] = useState(editing?.description ?? '');
  const [thesis, setThesis] = useState(editing?.thesis ?? '');
  const [domain, setDomain] = useState<Domain>((editing?.domain as Domain) ?? 'general');
  const [obsidianVaultPath, setObsidianVaultPath] = useState(editing?.obsidianVaultPath ?? '');
  const [saving, setSaving] = useState(false);

  const domainOptions = DOMAINS.map((d) => ({ value: d, label: domainLabel(t, d) }));

  const handlePickVault = async () => {
    const selected = await open({ directory: true, title: t.research_lab.select_vault });
    if (selected) setObsidianVaultPath(selected as string);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      if (editing) {
        await updateProject(editing.id, {
          name: name.trim(),
          description: description.trim() || null,
          thesis: thesis.trim() || null,
          domain,
          obsidianVaultPath: obsidianVaultPath.trim() || null,
        });
      } else {
        const project = await createProject({
          name: name.trim(),
          description: description.trim() || undefined,
          thesis: thesis.trim() || undefined,
          domain,
          obsidianVaultPath: obsidianVaultPath.trim() || undefined,
        });
        setActiveProject(project.id);
      }
      onClose();
    } catch (err) {
      toastCatch(editing ? "ResearchProjectForm:update" : "ResearchProjectForm:create")(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <ResearchLabFormModal
      title={editing ? t.research_lab.edit_project : t.research_lab.create_project}
      onClose={onClose}
      onSubmit={handleSubmit}
      submitLabel={editing ? t.research_lab.save_changes : t.research_lab.create_project}
      submitDisabled={!name.trim()}
      saving={saving}
    >
      <TextField
        label={t.research_lab.project_name}
        value={name}
        onChange={setName}
        placeholder={t.research_lab.project_name_placeholder}
        autoFocus
        required
      />

      <TextAreaField
        label={t.research_lab.project_thesis}
        value={thesis}
        onChange={setThesis}
        placeholder={t.research_lab.project_thesis_placeholder}
        rows={2}
      />

      <TextAreaField
        label={t.research_lab.project_description}
        value={description}
        onChange={setDescription}
        placeholder={t.research_lab.project_description_placeholder}
        rows={3}
      />

      <SelectField
        label={t.research_lab.project_domain}
        value={domain}
        onChange={setDomain}
        options={domainOptions}
      />

      <Field label={t.research_lab.obsidian_vault}>
        {(id) => (
          <div className="flex items-stretch gap-2">
            <button
              id={id}
              type="button"
              onClick={handlePickVault}
              className="flex items-center gap-2 flex-1 px-3 py-2 rounded-card bg-secondary/50 border border-border/30 text-foreground typo-body cursor-pointer hover:border-primary/40 transition-colors text-left"
            >
              <FolderOpen className="w-4 h-4 text-foreground flex-shrink-0" />
              {obsidianVaultPath ? (
                <span className="truncate">{obsidianVaultPath}</span>
              ) : (
                <span className="text-foreground">{t.research_lab.obsidian_vault_hint}</span>
              )}
            </button>
            {obsidianVaultPath && (
              <button
                type="button"
                onClick={() => setObsidianVaultPath('')}
                className="px-2 rounded-card bg-secondary/50 border border-border/30 text-foreground hover:text-foreground hover:border-primary/40 transition-colors"
                title={t.research_lab.clear_vault}
                aria-label={t.research_lab.clear_vault}
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        )}
      </Field>
    </ResearchLabFormModal>
  );
}
