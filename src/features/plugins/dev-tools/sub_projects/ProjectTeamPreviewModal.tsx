import { useCallback, useEffect, useMemo, useState } from 'react';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { Activity, ChevronDown, ExternalLink, Layers, Users, X } from 'lucide-react';
import { BaseModal } from '@/lib/ui/BaseModal';
import { Button } from '@/features/shared/components/buttons';
import { PersonaIcon } from '@/features/agents/components/PersonaIcon';
import { useTranslation } from '@/i18n/useTranslation';
import { useAgentStore } from '@/stores/agentStore';
import { useSystemStore } from '@/stores/systemStore';
import { usePipelineStore } from '@/stores/pipelineStore';
import { formatRelativeTime } from '@/lib/utils/formatters';
import type { PersonaTeam } from '@/lib/bindings/PersonaTeam';
import type { PersonaTeamMember } from '@/lib/bindings/PersonaTeamMember';
import type { PersonaTeamConnection } from '@/lib/bindings/PersonaTeamConnection';
import type { PipelineRun } from '@/lib/bindings/PipelineRun';
import { listTeamMembers, listTeamConnections, listPipelineRuns } from '@/api/pipeline/teams';
import { TeamGraphPreview } from './TeamGraphPreview';
import { colorWithAlpha } from '@/lib/utils/colorWithAlpha';
import { silentCatch } from '@/lib/silentCatch';
import { useTypedTauriEvent } from '@/hooks/useTauriEvent';
import { EventName } from '@/lib/eventRegistry';

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
  const personaLastRun = useAgentStore((s) => s.personaLastRun);
  const personaHealthMap = useAgentStore((s) => s.personaHealthMap);
  const selectPersona = useAgentStore((s) => s.selectPersona);
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);
  const setAgentTab = useSystemStore((s) => s.setAgentTab);
  const teams = usePipelineStore((s) => s.teams);
  const fetchTeams = usePipelineStore((s) => s.fetchTeams);
  useEffect(() => {
    if (open) void fetchTeams();
  }, [open, fetchTeams]);
  const groupMetaById = useMemo(
    () => new Map(teams.map((g) => [g.id, { name: g.name, color: g.color }])),
    [teams],
  );

  const [members, setMembers] = useState<PersonaTeamMember[] | null>(null);
  const [connections, setConnections] = useState<PersonaTeamConnection[] | null>(null);
  const [runs, setRuns] = useState<PipelineRun[] | null>(null);
  const [loading, setLoading] = useState(false);
  // Cycle 23 — inline member-detail expansion. Holds the team-member id
  // whose detail panel is open; clicking the same row again closes it.
  const [expandedMemberId, setExpandedMemberId] = useState<string | null>(null);
  // Reset on team change so a previously-expanded row from another team
  // doesn't ghost in.
  useEffect(() => {
    setExpandedMemberId(null);
  }, [team.id]);

  const handleOpenInEditor = (personaId: string) => {
    setSidebarSection('personas');
    setAgentTab('all');
    selectPersona(personaId);
    onClose();
  };
  // Visual cue that the runs list updated from a live event in the last beat.
  // Resets after a short timeout so it pulses on each new tick rather than
  // staying lit forever once the first event arrives.
  const [livePulseAt, setLivePulseAt] = useState(0);

  // Re-fetch just the run list. Cheap (single indexed SELECT) — runs only
  // when a PIPELINE_STATUS event for this team arrives, so the steady-state
  // cost when nothing is running is zero.
  const refetchRuns = useCallback(async () => {
    try {
      const r = await listPipelineRuns(team.id);
      setRuns(r.slice(0, RECENT_RUN_LIMIT));
      setLivePulseAt(Date.now());
    } catch (err) {
      silentCatch('features/plugins/dev-tools/sub_projects/ProjectTeamPreviewModal:refetchRuns')(err);
    }
  }, [team.id]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setMembers(null);
    setConnections(null);
    setRuns(null);
    Promise.all([
      listTeamMembers(team.id),
      listTeamConnections(team.id),
      listPipelineRuns(team.id),
    ])
      .then(([m, c, r]) => {
        setMembers(m);
        setConnections(c);
        setRuns(r.slice(0, RECENT_RUN_LIMIT));
      })
      .catch((err) => {
        silentCatch('features/plugins/dev-tools/sub_projects/ProjectTeamPreviewModal:fetch')(err);
        setMembers([]);
        setConnections([]);
        setRuns([]);
      })
      .finally(() => setLoading(false));
  }, [open, team.id]);

  // Subscribe to PIPELINE_STATUS while the modal is open. Backend emits this
  // every time a pipeline run transitions (queued → running → completed/failed)
  // OR a member node within a run flips status. Filtering by team_id keeps
  // us from re-fetching for unrelated teams. The hook handles
  // mount/unmount cleanup; closing the modal unmounts and unsubscribes.
  useTypedTauriEvent(EventName.PIPELINE_STATUS, useCallback((payload) => {
    if (!open) return;
    if (payload.team_id !== team.id) return;
    void refetchRuns();
  }, [open, team.id, refetchRuns]));

  // 250ms "live" pulse window — drives the eyebrow dot animation.
  const isPulsing = livePulseAt > 0 && Date.now() - livePulseAt < 1500;

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
        {/* Mini canvas — read-only fit-to-rect view of member positions +
            connections. Hidden until both members and connections have
            loaded; renders as a thin band above the textual lists so the
            developer sees the shape of the pipeline at a glance. */}
        {members && connections && members.length > 0 && (
          <TeamGraphPreview
            members={members}
            connections={connections}
            personas={personas}
            teamColor={teamColor}
            onPersonaOpened={onClose}
          />
        )}

        {/* Members */}
        <section>
          <div className="flex items-center gap-2 mb-2">
            <Users className="w-3.5 h-3.5 text-foreground" />
            <h3 className="typo-label uppercase tracking-wider text-foreground">
              {t.plugins.dev_projects.team_preview_members}
            </h3>
            {members && (
              <span className="typo-label text-foreground">({members.length})</span>
            )}
          </div>
          {loading && (
            <p className="typo-body text-foreground">{t.plugins.dev_projects.team_preview_loading}</p>
          )}
          {!loading && members && members.length === 0 && (
            <p className="typo-body text-foreground">
              {t.plugins.dev_projects.team_preview_no_members}
            </p>
          )}
          {!loading && members && members.length > 0 && (
            <ul className="space-y-1.5">
              {members.map((m) => {
                const persona = personas.find((p) => p.id === m.persona_id);
                const isExpanded = expandedMemberId === m.id;
                const health = persona ? personaHealthMap[persona.id] : undefined;
                const lastRun = persona ? personaLastRun[persona.id] : null;
                const personaGroup = persona?.home_team_id ? groupMetaById.get(persona.home_team_id) : null;
                return (
                  <li key={m.id} className="rounded-card bg-secondary/30 border border-primary/10">
                    <button
                      type="button"
                      onClick={() => setExpandedMemberId(isExpanded ? null : m.id)}
                      aria-expanded={isExpanded}
                      disabled={!persona}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 hover:bg-secondary/50 disabled:hover:bg-transparent transition-colors text-left rounded-card"
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
                            <span className="text-foreground">
                              {t.plugins.dev_projects.team_preview_unknown_persona}
                            </span>
                          )}
                        </div>
                        {m.role && (
                          <div className="typo-caption text-foreground truncate">{m.role}</div>
                        )}
                      </div>
                      {persona && (
                        <ChevronDown
                          className={`w-3.5 h-3.5 text-foreground flex-shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                        />
                      )}
                    </button>
                    {isExpanded && persona && (
                      <div className="px-3 pb-3 pt-1 space-y-2 border-t border-primary/10">
                        {persona.description && (
                          <p className="typo-caption text-foreground leading-relaxed">
                            {persona.description}
                          </p>
                        )}
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 typo-caption">
                          {/* Status pill — enabled vs disabled */}
                          <span
                            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border ${
                              persona.enabled
                                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                                : 'border-foreground/20 bg-secondary/40 text-foreground/60'
                            }`}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                persona.enabled ? 'bg-emerald-400' : 'bg-foreground/30'
                              }`}
                            />
                            {persona.enabled
                              ? t.plugins.dev_projects.team_preview_member_enabled
                              : t.plugins.dev_projects.team_preview_member_disabled}
                          </span>
                          {/* Group binding */}
                          {personaGroup && (
                            <span
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border"
                              style={{
                                backgroundColor: colorWithAlpha(personaGroup.color || '#6366f1', 0.1),
                                borderColor: colorWithAlpha(personaGroup.color || '#6366f1', 0.4),
                                color: personaGroup.color || '#6366f1',
                              }}
                            >
                              <Layers className="w-3 h-3" />
                              {personaGroup.name}
                            </span>
                          )}
                          {/* Health badge — only when degraded/failing matters */}
                          {health && health.status !== 'healthy' && (
                            <span
                              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border ${
                                health.status === 'failing'
                                  ? 'border-red-500/40 bg-red-500/10 text-red-300'
                                  : 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                              }`}
                            >
                              <span className="capitalize">{health.status}</span>
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 typo-caption text-foreground">
                          <span>
                            {t.plugins.dev_projects.team_preview_member_trust}:{' '}
                            <span className="font-mono text-foreground">
                              {persona.trust_score != null ? <Numeric value={persona.trust_score} precision={2} /> : '—'}
                            </span>
                          </span>
                          <span>
                            {t.plugins.dev_projects.team_preview_member_last_run}:{' '}
                            <span className="text-foreground">
                              {lastRun ? formatRelativeTime(lastRun) : t.plugins.dev_projects.team_preview_member_never_run}
                            </span>
                          </span>
                          {persona.max_budget_usd != null && (
                            <span>
                              {t.plugins.dev_projects.team_preview_member_budget}:{' '}
                              <span className="text-foreground">${persona.max_budget_usd}</span>
                            </span>
                          )}
                        </div>
                        <div className="pt-1">
                          <button
                            type="button"
                            onClick={() => handleOpenInEditor(persona.id)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-card border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20 typo-caption font-medium transition-colors"
                          >
                            <ExternalLink className="w-3 h-3" />
                            {t.plugins.dev_projects.team_preview_member_open}
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Recent runs */}
        <section>
          <div className="flex items-center gap-2 mb-2">
            <Activity className="w-3.5 h-3.5 text-foreground" />
            <h3 className="typo-label uppercase tracking-wider text-foreground">
              {t.plugins.dev_projects.team_preview_recent_runs}
            </h3>
            {runs && (
              <span className="typo-label text-foreground">
                {tx(t.plugins.dev_projects.team_preview_recent_runs_total, { count: runs.length })}
              </span>
            )}
            {isPulsing && (
              <span
                className="ml-auto inline-flex items-center gap-1.5 typo-caption text-emerald-400/80"
                title={t.plugins.dev_projects.team_preview_live_label}
              >
                <span className="relative flex w-2 h-2">
                  <span className="absolute inline-flex w-full h-full rounded-full bg-emerald-400/70 opacity-70 animate-ping" />
                  <span className="relative inline-flex w-2 h-2 rounded-full bg-emerald-400" />
                </span>
                {t.plugins.dev_projects.team_preview_live_label}
              </span>
            )}
          </div>
          {loading && (
            <p className="typo-body text-foreground">{t.plugins.dev_projects.team_preview_loading}</p>
          )}
          {!loading && runs && runs.length === 0 && (
            <p className="typo-body text-foreground">
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
                    <span className="typo-caption text-foreground capitalize w-16 flex-shrink-0">
                      {r.status}
                    </span>
                    <span className="typo-caption text-foreground flex-1 truncate">
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
