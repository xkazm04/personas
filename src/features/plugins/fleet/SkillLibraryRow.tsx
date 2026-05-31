import { Terminal, Download } from 'lucide-react';
import type { SkillEntry } from '@/api/devTools/devTools';
import { useTranslation } from '@/i18n/useTranslation';

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
    <div className="group flex items-center gap-1 rounded-card border border-transparent hover:border-primary/15 hover:bg-secondary/30 transition-colors">
      <button
        type="button"
        data-testid={`fleet-drawer-apply-${skill.name}`}
        disabled={!canApply}
        onClick={() => onLoad(skill.name)}
        title={canApply ? `/${skill.name}` : f.skills_drawer_no_target}
        className="flex-1 min-w-0 text-left px-2 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <div className="flex items-center gap-1.5">
          <Terminal className="w-3 h-3 text-primary shrink-0" aria-hidden="true" />
          <span className="typo-card-label truncate">{skill.name}</span>
        </div>
        {skill.description && (
          <p className="text-[10px] text-foreground opacity-60 truncate mt-0.5 pl-4.5">{skill.description}</p>
        )}
      </button>
      <button
        type="button"
        data-testid={`fleet-drawer-install-${skill.name}`}
        onClick={() => onInstall(skill.name)}
        title={f.skill_install}
        aria-label={f.skill_install}
        className="shrink-0 p-1.5 mr-1 rounded text-foreground opacity-0 group-hover:opacity-70 hover:opacity-100 transition-opacity"
      >
        <Download className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
