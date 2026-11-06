import { Terminal, Download } from 'lucide-react';
import type { SkillEntry } from '@/api/devTools/devTools';
import { useTranslation } from '@/i18n/useTranslation';
import Button from '@/features/shared/components/buttons/Button';
import { Tooltip } from '@/features/shared/components/display/Tooltip';

interface Props {
  skill: SkillEntry;
  /** Apply is disabled when no session is focused. */
  canApply: boolean;
  /** Load `/skill ` into the drawer composer for editing. */
  onLoad: (name: string) => void;
  /** Open the install-to-repo flow for this skill. */
  onInstall: (name: string) => void;
}

/** One skill row in the library drawer — click the name to load it into the
 *  composer; the trailing icon opens install-to-repo. */
export function SkillLibraryRow({ skill, canApply, onLoad, onInstall }: Props) {
  const { t } = useTranslation();
  const f = t.plugins.fleet;
  return (
    <div className="group flex items-center gap-1 rounded-card border border-transparent hover:border-hair hover:bg-surface-1 transition-colors">
      <Tooltip content={canApply ? `/${skill.name}` : f.skills_drawer_no_target}><button
        type="button"
        data-testid={`fleet-drawer-apply-${skill.name}`}
        disabled={!canApply}
        onClick={() => onLoad(skill.name)}
        className="flex-1 min-w-0 text-left px-2 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <div className="flex items-center gap-1.5">
          <Terminal className="w-3 h-3 text-primary shrink-0" aria-hidden="true" />
          <span className="typo-card-label truncate">{skill.name}</span>
          {skill.syncState === 'diverged' && (
            <Tooltip content={f.skill_sync_diverged_hint}><span
              data-testid={`fleet-drawer-drift-${skill.name}`}
              className="shrink-0 rounded-interactive bg-status-warning/15 px-1.5 py-px typo-caption text-status-warning"
            >
              {f.skill_sync_diverged}
            </span></Tooltip>
          )}
          {skill.syncState === 'in_sync' && (
            <Tooltip content={f.skill_sync_in_sync_hint}><span
              className="shrink-0 rounded-interactive bg-status-success/15 px-1.5 py-px typo-caption text-status-success"
            >
              {f.skill_sync_in_sync}
            </span></Tooltip>
          )}
        </div>
        {skill.description && (
          <p className="typo-caption text-ink-2 truncate mt-0.5 pl-4.5">{skill.description}</p>
        )}
      </button></Tooltip>
      <Button variant="ghost" size="icon-sm"
        type="button"
        data-testid={`fleet-drawer-install-${skill.name}`}
        onClick={() => onInstall(skill.name)}
        tooltip={f.skill_install}
        aria-label={f.skill_install}
        className="shrink-0 mr-1 group-hover:opacity-70"
      >
        <Download className="w-3.5 h-3.5" />
      </Button>
    </div>
  );
}
