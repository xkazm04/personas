import { useState } from 'react';
import { X, FolderOpen } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';

const DOMAINS = ['cs', 'biology', 'chemistry', 'physics', 'mathematics', 'business', 'medicine', 'general'];

interface Props {
  onClose: () => void;
}

export default function ResearchProjectForm({ onClose }: Props) {
  const { t } = useTranslation();
  const createProject = useSystemStore((s) => s.createResearchProject);
  const setActiveProject = useSystemStore((s) => s.setActiveResearchProject);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [thesis, setThesis] = useState('');
  const [domain, setDomain] = useState('general');
  const [obsidianVaultPath, setObsidianVaultPath] = useState('');
  const [saving, setSaving] = useState(false);

  const handlePickVault = async () => {
    const selected = await open({ directory: true, title: t.research_lab.select_vault });
    if (selected) setObsidianVaultPath(selected as string);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      const project = await createProject({
        name: name.trim(),
        description: description.trim() || undefined,
        thesis: thesis.trim() || undefined,
        domain,
        obsidianVaultPath: obsidianVaultPath.trim() || undefined,
      });
      setActiveProject(project.id);
      onClose();
    } catch (err) {
      toastCatch("ResearchProjectForm:create")(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-card bg-background border border-border/50 shadow-2xl p-6 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="typo-heading text-foreground">{t.research_lab.create_project}</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-secondary/50 text-foreground/50">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="typo-caption text-foreground/60 block mb-1">{t.research_lab.project_name}</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t.research_lab.project_name}
              className="w-full px-3 py-2 rounded-lg bg-secondary/50 border border-border/30 text-foreground typo-body placeholder:text-foreground/30 focus:outline-none focus:border-primary/40"
              autoFocus
            />
          </div>

          <div>
            <label className="typo-caption text-foreground/60 block mb-1">{t.research_lab.project_thesis}</label>
            <textarea
              value={thesis}
              onChange={(e) => setThesis(e.target.value)}
              placeholder={t.research_lab.project_thesis}
              rows={2}
              className="w-full px-3 py-2 rounded-lg bg-secondary/50 border border-border/30 text-foreground typo-body placeholder:text-foreground/30 focus:outline-none focus:border-primary/40 resize-none"
            />
          </div>

          <div>
            <label className="typo-caption text-foreground/60 block mb-1">{t.research_lab.project_description}</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t.research_lab.project_description}
              rows={3}
              className="w-full px-3 py-2 rounded-lg bg-secondary/50 border border-border/30 text-foreground typo-body placeholder:text-foreground/30 focus:outline-none focus:border-primary/40 resize-none"
            />
          </div>

          <div>
            <label className="typo-caption text-foreground/60 block mb-1">{t.research_lab.project_domain}</label>
            <select
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-secondary/50 border border-border/30 text-foreground typo-body focus:outline-none focus:border-primary/40"
            >
              {DOMAINS.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="typo-caption text-foreground/60 block mb-1">{t.research_lab.obsidian_vault}</label>
            <div
              onClick={handlePickVault}
              className="flex items-center gap-2 w-full px-3 py-2 rounded-lg bg-secondary/50 border border-border/30 text-foreground typo-body cursor-pointer hover:border-primary/40 transition-colors"
            >
              <FolderOpen className="w-4 h-4 text-foreground/40 flex-shrink-0" />
              {obsidianVaultPath ? (
                <span className="truncate">{obsidianVaultPath}</span>
              ) : (
                <span className="text-foreground/30">{t.research_lab.obsidian_vault_hint}</span>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg typo-body text-foreground/60 hover:bg-secondary/50 transition-colors"
            >
              {t.common.cancel}
            </button>
            <button
              type="submit"
              disabled={!name.trim() || saving}
              className="px-4 py-2 rounded-lg typo-body bg-primary/20 text-primary hover:bg-primary/30 transition-colors disabled:opacity-50"
            >
              {saving ? t.common.loading : t.research_lab.create_project}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
