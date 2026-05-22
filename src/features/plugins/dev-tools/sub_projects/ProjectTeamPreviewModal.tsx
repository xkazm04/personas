import { useEffect, useState } from 'react';
import { Activity, Users, X } from 'lucide-react';
import { BaseModal } from '@/lib/ui/BaseModal';
import { Button } from '@/features/shared/components/buttons';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import { useTranslation } from '@/i18n/useTranslation';
import { useAgentStore } from '@/stores/agentStore';
import type { PersonaTeam } from '@/lib/bindings/PersonaTeam';
import type { PersonaTeamMember } from '@/lib/bindings/PersonaTeamMember';
import type { PipelineRun } from '@/lib/bindings/PipelineRun';
import { listTeamMembers, listPipelineRuns } from '@/api/pipeline/teams';
import { colorWithAlpha } from '@/lib/utils/colorWithAlpha';
import { silentCatch } from '@/lib/silentCatch';

const RECENT_RUN_LIMIT = 6;

interface ProjectTeamPreviewModalProps {
  open: boolean;
  team: PersonaTeam;
  onClose: () => void;
}

/**
 * Lightweight preview of the PersonaTeam pipeline bound to a Dev-Tools
 * project. Read-only Stage 1: lists members (as PersonaIcons) and the most
 * recent N pipeline runs. A future stage can render the actual canvas as
 * a fit-to-rect SVG; for now the list + run history covers the "what is
 * this team doing for my project right now?" question.
 */
export function ProjectTeamPreviewModal({ open, team, onClose }: ProjectTeamPreviewModalProps) {
  const { t, tx } = useTranslation();
  const personas = useAgentStore((s) => s.personas);

  const [members, setMembers] = useState<PersonaTeamMember[] | null>(null);
  const [runs, setRuns] = useState<PipelineRun[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setMembers(null);
    setRuns(null);
    Promise.all([listTeamMembers(team.id), listPipelineRuns(team.id)])
      .then(([m, r]) => {
        setMembers(m);
        setRuns(r.slice(0, RECENT_RUN_LIMIT));
      })
      .catch((err) => {
        silentCatch('features/plugins/dev-tools/sub_projects/ProjectTeamPreviewModal:fetch')(err);
        setMembers([]);
        setRuns([]);
      })
      .finally(() => setLoading(false));
  }, [open, team.id]);

  const teamColor = team.color || '#6366f1';

  return (
    <BaseModal
      isOpen={open}
      onClose={onClose}
      titleId="project-team-preview-title"
      size="md"
      panelClassName="bg-background border border-primary/15 rounded-2xl shadow-elevation-4 overflow-hidden flex flex-col max-h-[80vh]"
    >
      <div
        className="px-5 pt-5 pb-3 border-b border-primary/10 flex items-center justify-between"
        style={{ borderLeft: `3px solid ${colorWithAlpha(teamColor, 0.8)}` }}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <Users className="w-4 h-4 flex-shrink-0" style={{ color: teamColor }} />
          <div className="min-w-0">
            <h2
              id="project-team-preview-title"
              className="typo-heading font-semibold text-foreground/90 truncate"
            >
              {team.name}
            </h2>
            {team.description && (
              <p className="typo-caption text-foreground line-clamp-1">{team.description}</p>
            )}
          </div>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label={t.common.close}>
          <X className="w-4 h-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        {/* Members */}
        <section>
          <div className="flex items-center gap-2 mb-2">
            <Users className="w-3.5 h-3.5 text-foreground/60" />
            <h3 className="typo-label uppercase tracking-wider text-foreground/70">
              {t.plugins.dev_projects.team_preview_members}
            </h3>
            {members && (
              <span className="typo-label text-foreground/50">({members.length})</span>
            )}
          </div>
          {loading && (
            <p className="typo-body text-foreground/60">{t.plugins.dev_projects.team_preview_loading}</p>
          )}
          {!loading && members && members.length === 0 && (
            <p className="typo-body text-foreground/60">
              {t.plugins.dev_projects.team_preview_no_members}
            </p>
          )}
          {!loading && members && members.length > 0 && (
            <ul className="grid grid-cols-2 gap-2">
              {members.map((m) => {
                const persona = personas.find((p) => p.id === m.persona_id);
                return (
                  <li
                    key={m.id}
                    className="flex items-center gap-2 px-2.5 py-1.5 rounded-card bg-secondary/30 border border-primary/10"
                  >
                    <PersonaIcon
                      icon={persona?.icon ?? null}
                      color={persona?.color ?? null}
                      display="pop"
                      frameSize="sm"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="typo-body text-foreground/90 truncate">
                        {persona?.name ?? (
                          <span className="text-foreground/50">
                            {t.plugins.dev_projects.team_preview_unknown_persona}
                          </span>
                        )}
                      </div>
                      {m.role && (
                        <div className="typo-caption text-foreground/60 truncate">{m.role}</div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Recent runs */}
        <section>
          <div className="flex items-center gap-2 mb-2">
            <Activity className="w-3.5 h-3.5 text-foreground/60" />
            <h3 className="typo-label uppercase tracking-wider text-foreground/70">
              {t.plugins.dev_projects.team_preview_recent_runs}
            </h3>
            {runs && (
              <span className="typo-label text-foreground/50">
                {tx(t.plugins.dev_projects.team_preview_recent_runs_total, { count: runs.length })}
              </span>
            )}
          </div>
          {loading && (
            <p className="typo-body text-foreground/60">{t.plugins.dev_projects.team_preview_loading}</p>
          )}
          {!loading && runs && runs.length === 0 && (
            <p className="typo-body text-foreground/60">
              {t.plugins.dev_projects.team_preview_no_runs}
            </p>
          )}
          {!loading && runs && runs.length > 0 && (
            <ul className="space-y-1.5">
              {runs.map((r) => {
                const date = new Date(r.started_at);
                const dateStr = date.toLocaleString();
                const isFinished = r.status !== 'running' && r.status !== 'queued';
                return (
                  <li
                    key={r.id}
                    className="flex items-center gap-3 px-2.5 py-1.5 rounded-card bg-secondary/30 border border-primary/10"
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                        r.status === 'running'
                          ? 'bg-blue-400 animate-pulse'
                          : r.status === 'failed'
                            ? 'bg-red-400'
                            : r.status === 'completed'
                              ? 'bg-emerald-400'
                              : 'bg-foreground/30'
                      }`}
                    />
                    <span className="typo-caption text-foreground/70 capitalize w-16 flex-shrink-0">
                      {r.status}
                    </span>
                    <span className="typo-caption text-foreground/60 flex-1 truncate">
                      {dateStr}
                    </span>
                    {isFinished && r.error_message && (
                      <span
                        className="typo-caption text-red-400/80 truncate max-w-[40%]"
                        title={r.error_message}
                      >
                        {r.error_message}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <div className="px-5 py-3 border-t border-primary/10 flex items-center justify-end">
        <Button variant="ghost" size="sm" onClick={onClose}>
          {t.common.close}
        </Button>
      </div>
    </BaseModal>
  );
}
