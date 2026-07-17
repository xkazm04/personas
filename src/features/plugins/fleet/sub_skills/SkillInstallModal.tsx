import { useEffect, useState } from 'react';
import { FolderOpen, X, Download } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { BaseModal } from '@/lib/ui/BaseModal';
import { Button } from '@/features/shared/components/buttons';
import { useSystemStore } from '@/stores/systemStore';
import { useToastStore } from '@/stores/toastStore';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import type { SkillInstallResult } from '@/lib/bindings/SkillInstallResult';
import type { SkillInstallPreview } from '@/api/devTools/devTools';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Name of the skill to install (the currently-selected skill). */
  skillName: string | null;
  /** Copies the skill into the chosen project; resolves with the backend
   *  result (or null on error, which is toasted upstream). */
  onInstall: (targetProjectId: string, overwrite: boolean) => Promise<SkillInstallResult | null>;
  /** Previews what a (re-)install would change at the chosen target, without
   *  writing. Resolves null on error (the summary is simply hidden). */
  onPreview: (targetProjectId: string) => Promise<SkillInstallPreview | null>;
}

/**
 * Install-a-skill-into-a-repo picker. Lists registered dev projects as copy
 * targets and writes the skill's files into that project's `.claude/skills`.
 * On an "already exists" result it primes the overwrite toggle so a second
 * click replaces in place.
 */
export function SkillInstallModal({ open, onClose, skillName, onInstall, onPreview }: Props) {
  const { t, tx } = useTranslation();
  const fleet = t.plugins.fleet;
  const projects = useSystemStore(useShallow((s) => s.projects));
  const fetchProjects = useSystemStore((s) => s.fetchProjects);
  const addToast = useToastStore((s) => s.addToast);

  const [targetId, setTargetId] = useState('');
  const [overwrite, setOverwrite] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [preview, setPreview] = useState<SkillInstallPreview | null>(null);

  // Reset transient state when the modal opens, default the target to the
  // first project, and refresh the project list. Deps are intentionally just
  // `[open]` — re-running on projects/fetchProjects identity changes would
  // clobber the overwrite toggle we prime after an "exists" result.
  useEffect(() => {
    if (!open) return;
    setOverwrite(false);
    setInstalling(false);
    setPreview(null);
    setTargetId((cur) => cur || projects[0]?.id || '');
    fetchProjects().catch(silentCatch('SkillInstallModal:fetchProjects'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Fetch a diff preview whenever the target changes so the user sees what a
  // re-install would overwrite BEFORE committing. Ignored for a fresh install
  // (targetExists === false → nothing to overwrite).
  useEffect(() => {
    if (!open || !skillName || !targetId) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    onPreview(targetId).then((p) => {
      if (!cancelled) setPreview(p);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, skillName, targetId]);

  const handleConfirm = async () => {
    if (!skillName || !targetId || installing) return;
    setInstalling(true);
    const result = await onInstall(targetId, overwrite);
    setInstalling(false);
    if (!result) return; // error already surfaced by the caller
    const projectName = projects.find((p) => p.id === targetId)?.name ?? targetId;
    if (result.installed) {
      addToast(
        tx(fleet.skill_install_success, { skill: skillName, project: projectName, count: result.fileCount }),
        'success',
      );
      onClose();
    } else if (result.reason === 'exists') {
      addToast(tx(fleet.skill_install_exists, { skill: skillName, project: projectName }), 'warning');
      setOverwrite(true); // prime the replace; a second confirm overwrites
    }
  };

  return (
    <BaseModal
      isOpen={open}
      onClose={onClose}
      titleId="skill-install-title"
      size="sm"
      panelClassName="bg-background border border-primary/10 rounded-2xl p-5 shadow-elevation-4"
    >
      <div data-testid="skill-install-modal">
        <div className="flex items-center justify-between mb-4">
          <h2 id="skill-install-title" className="typo-section-title">{fleet.skill_install_title}</h2>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label={t.common.cancel}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        {skillName && (
          <p className="typo-caption text-foreground mb-3">
            {tx(fleet.skill_install_desc, { skill: skillName })}
          </p>
        )}

        {projects.length === 0 ? (
          <p className="typo-caption text-foreground py-4">{fleet.skill_install_no_targets}</p>
        ) : (
          <>
            <span className="typo-caption font-medium text-foreground mb-1.5 block">
              {fleet.skill_install_target_label}
            </span>
            <div className="max-h-[220px] overflow-y-auto border border-primary/10 rounded-modal p-1.5 bg-secondary/20 space-y-0.5 mb-3">
              {projects.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  data-testid={`skill-install-target-${p.id}`}
                  onClick={() => setTargetId(p.id)}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-card text-left transition-colors ${
                    targetId === p.id
                      ? 'bg-primary/10 border border-primary/25'
                      : 'hover:bg-secondary/40 border border-transparent'
                  }`}
                >
                  <FolderOpen className="w-3.5 h-3.5 text-foreground shrink-0" aria-hidden="true" />
                  <span className="typo-caption truncate">{p.name}</span>
                </button>
              ))}
            </div>

            {preview?.targetExists && (
              <div
                data-testid="skill-install-diff"
                className="mb-3 rounded-modal border border-status-warning/25 bg-status-warning/10 p-2.5"
              >
                <p className="typo-caption font-medium text-status-warning mb-1">
                  {tx(fleet.skill_install_diff_summary, {
                    changed: preview.changedCount,
                    added: preview.addedCount,
                    removed: preview.removedCount,
                  })}
                </p>
                {preview.deltas.length > 0 && (
                  <ul className="max-h-[110px] overflow-y-auto space-y-0.5 font-mono text-[11px] text-foreground">
                    {preview.deltas.map((d) => (
                      <li key={`${d.status}:${d.file}`} className="truncate">
                        <span
                          className={`font-semibold ${d.status === 'added' ? 'text-status-success' : d.status === 'removed' ? 'text-status-warning' : 'text-primary'}`}
                        >
                          {d.status === 'added' ? '+' : d.status === 'removed' ? '−' : '~'}
                        </span>{' '}
                        {d.file}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <label className="flex items-center gap-2 typo-caption text-foreground cursor-pointer mb-4">
              <input
                type="checkbox"
                checked={overwrite}
                onChange={(e) => setOverwrite(e.target.checked)}
                className="rounded"
              />
              {fleet.skill_install_overwrite}
            </label>
          </>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>{t.common.cancel}</Button>
          <Button
            data-testid="skill-install-confirm"
            variant="primary"
            size="sm"
            icon={<Download className="w-3.5 h-3.5" />}
            disabled={!skillName || !targetId || installing || projects.length === 0}
            onClick={handleConfirm}
          >
            {installing ? fleet.skill_install_busy : fleet.skill_install_confirm}
          </Button>
        </div>
      </div>
    </BaseModal>
  );
}
