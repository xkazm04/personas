import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { BookOpen, Search, X, Terminal, Download, RefreshCw, AlertCircle } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import { useSkillData } from './sub_skills/useSkillData';
import { SkillInstallModal } from './sub_skills/SkillInstallModal';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Apply a skill's slash command to the focused terminal. */
  onApply: (skillName: string) => void;
  /** Display name of the session the skill applies to; null when none focused. */
  targetLabel: string | null;
}

/**
 * Left-anchored skill library drawer (F1 surfacing). Slides in over the left
 * sidebar region; lists the shared (global) skill library — searchable, with a
 * project/global source toggle. Clicking a skill writes its slash command into
 * the focused session's terminal (`onApply`); each row also offers
 * "Install to repo" (reuses SkillInstallModal). Portaled to body so it sits
 * above both the single-pane view and the fullscreen grid overlay.
 */
export function SkillLibraryDrawer({ open, onClose, onApply, targetLabel }: Props) {
  const { t, tx } = useTranslation();
  const f = t.plugins.fleet;
  // Default to the shared (global) library — the cross-repo source.
  const { filtered, loading, search, setSearch, source, setSource, fetchSkills, installSkill } =
    useSkillData('global');
  const [installName, setInstallName] = useState<string | null>(null);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const canApply = targetLabel !== null;
  const sources: { id: typeof source; label: string }[] = [
    { id: 'global', label: f.skill_source_global },
    { id: 'project', label: f.skill_source_project },
  ];

  return createPortal(
    <div className="fixed inset-0 top-12 z-[300]" data-testid="fleet-skills-drawer" role="region" aria-label={f.skills_drawer_title}>
      {/* Scrim */}
      <div className="absolute inset-0 bg-black/50 surface-blur-modal" onClick={onClose} aria-hidden="true" />

      {/* Left panel — roughly sidebar-width, slides in. */}
      <div className="animate-fade-slide-in absolute left-0 top-0 bottom-0 w-[340px] max-w-[85vw] flex flex-col bg-background border-r border-primary/10 shadow-elevation-4">
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-primary/10 shrink-0">
          <BookOpen className="w-4 h-4 text-primary" aria-hidden="true" />
          <span className="typo-caption font-semibold text-foreground">{f.skills_drawer_title}</span>
          <Button variant="ghost" size="icon-sm" className="ml-auto" onClick={onClose} aria-label={t.common.close}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Apply target hint */}
        <div className={`px-3 py-1.5 text-[11px] border-b border-primary/5 ${canApply ? 'text-foreground' : 'text-amber-300'}`}>
          {canApply ? tx(f.skills_drawer_apply_to, { name: targetLabel }) : f.skills_drawer_no_target}
        </div>

        {/* Source toggle + refresh */}
        <div className="flex items-center gap-1 px-3 py-2 shrink-0">
          <div className="inline-flex items-center rounded-card border border-primary/10 bg-secondary/30 p-0.5" role="group" aria-label={f.skill_source_label}>
            {sources.map((s) => (
              <button
                key={s.id}
                type="button"
                data-testid={`fleet-drawer-source-${s.id}`}
                aria-pressed={source === s.id}
                onClick={() => setSource(s.id)}
                className={`px-2 py-0.5 rounded-card text-[10px] font-medium transition-colors ${
                  source === s.id
                    ? 'bg-primary/10 text-primary border border-primary/25'
                    : 'text-foreground hover:bg-secondary/40 border border-transparent'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <Button variant="ghost" size="icon-sm" className="ml-auto" onClick={fetchSkills} aria-label={t.common.refresh} title={t.common.refresh}>
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        {/* Search */}
        <div className="relative px-3 pb-2 shrink-0">
          <Search className="pointer-events-none absolute left-5 top-1/2 w-3.5 h-3.5 -translate-y-1/2 text-foreground" aria-hidden="true" />
          <input
            type="text"
            data-testid="fleet-drawer-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label={f.skills_drawer_search}
            placeholder={f.skills_drawer_search}
            className="w-full rounded-input border border-primary/10 bg-secondary/40 py-1.5 pl-7 pr-2 text-[12px] text-foreground placeholder:text-foreground/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
          />
        </div>

        {/* Skill list */}
        <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-0.5" data-testid="fleet-drawer-list">
          {filtered.length === 0 ? (
            <div className="text-center py-8 text-[11px] text-foreground opacity-70">
              <AlertCircle className="w-5 h-5 mx-auto mb-1.5 opacity-60" aria-hidden="true" />
              {f.skills_drawer_empty}
            </div>
          ) : (
            filtered.map((skill) => (
              <div
                key={skill.name}
                className="group flex items-center gap-1 rounded-card border border-transparent hover:border-primary/15 hover:bg-secondary/30 transition-colors"
              >
                <button
                  type="button"
                  data-testid={`fleet-drawer-apply-${skill.name}`}
                  disabled={!canApply}
                  onClick={() => onApply(skill.name)}
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
                  onClick={() => setInstallName(skill.name)}
                  title={f.skill_install}
                  aria-label={f.skill_install}
                  className="shrink-0 p-1.5 mr-1 rounded text-foreground opacity-0 group-hover:opacity-70 hover:opacity-100 transition-opacity"
                >
                  <Download className="w-3.5 h-3.5" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Install-to-repo flow for a chosen skill. */}
      <SkillInstallModal
        open={installName !== null}
        onClose={() => setInstallName(null)}
        skillName={installName}
        onInstall={(targetProjectId, overwrite) =>
          installName ? installSkill(installName, targetProjectId, overwrite) : Promise.resolve(null)
        }
      />
    </div>,
    document.body,
  );
}
