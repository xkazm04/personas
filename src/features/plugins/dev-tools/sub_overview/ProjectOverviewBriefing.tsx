/**
 * Overview variant — "Briefing".
 *
 * Metaphor: a written status report / daily standup, not a tile wall. It opens
 * with a plain-language VERDICT ("Healthy" / "Needs attention") that interprets
 * the numbers for the user, then reads top-to-bottom as a narrow document
 * column: Signals readout → Integrations prose → Today timeline → Delivery
 * pipeline. Where the baseline shows raw tiles, the Briefing tells you what they
 * mean first and shows the supporting figures second.
 */
import {
  LayoutDashboard, RefreshCw, ChevronRight, Code2, Shield, CheckCircle2,
  AlertCircle, Key, GitBranch,
} from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useTranslation } from '@/i18n/useTranslation';
import { LifecycleProjectPicker } from '../sub_lifecycle/LifecycleProjectPicker';
import { EditableProjectPipeline } from './EditableProjectPipeline';
import { StandardsScanCard } from './StandardsScanCard';
import { splitSentrySlug } from './adapters';
import { useOverviewViewModel, type OverviewTone } from './overviewViewModel';
import { HealthDot, TONE_TEXT, TONE_BG, ACTIVITY_META, relTime } from './overviewShared';

/** Plain-language qualifier shown beside each signal's number. */
function toneWord(tone: OverviewTone): string {
  switch (tone) {
    case 'error': return 'elevated';
    case 'warning': return 'watch';
    case 'success': return 'clear';
    case 'info': return 'active';
    default: return 'idle';
  }
}

export default function ProjectOverviewBriefing() {
  const { t } = useTranslation();
  const po = t.project_overview;
  const vm = useOverviewViewModel();
  const {
    activeProject, activeProjectId, teams, credentials, tiles, verdict,
    repoState, repoStats, repoLinked, isGitLab, monitorState, monitorStats,
    monitorLinked, monitoringCred, todayActivity, lastLoadedAt, statsLoading, refresh,
  } = vm;

  if (!activeProject || !activeProjectId) return null;

  return (
    <ContentBox>
      <ContentHeader
        icon={
          <div className="relative">
            <LayoutDashboard className="w-5 h-5 text-primary" />
            <span className="absolute -top-0.5 -right-0.5"><HealthDot tone={verdict.tone} /></span>
          </div>
        }
        iconColor="primary"
        title={activeProject.name}
        subtitle={activeProject.root_path}
        actions={<LifecycleProjectPicker />}
      />

      <ContentBody centered>
        <div className="max-w-3xl mx-auto space-y-6">
          {/* ===== Verdict band — the interpretation, front and centre ===== */}
          <section className={`rounded-card border ${TONE_BG[verdict.tone]} px-6 py-5`}>
            <div className="flex items-start gap-4">
              <div className="pt-1"><HealthDot tone={verdict.tone} size={16} /></div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="typo-label text-foreground">{po.codebase}</span>
                  {lastLoadedAt && (
                    <span className="typo-caption text-foreground">
                      · {po.vital_updated_label}{' '}
                      <RelativeTime timestamp={lastLoadedAt} className="tabular-nums" />
                    </span>
                  )}
                </div>
                <h2 className={`typo-hero mt-0.5 ${TONE_TEXT[verdict.tone]}`}>{verdict.headline}</h2>
                <p className="typo-body-lg text-foreground mt-1">{verdict.detail}</p>
              </div>
              <button
                type="button"
                onClick={() => refresh()}
                title={t.common.refresh}
                aria-label={t.common.refresh}
                className="p-1.5 rounded-interactive hover:bg-primary/10 transition-colors shrink-0"
              >
                <RefreshCw className={`w-4 h-4 text-foreground ${statsLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </section>

          {/* ===== Signals readout — report rows, not tiles ===== */}
          <section>
            <h3 className="typo-label text-foreground mb-2">Signals</h3>
            <div className="rounded-card border border-primary/10 bg-card/30 divide-y divide-primary/5">
              {tiles.map((tile) => {
                const Icon = tile.icon;
                return (
                  <button
                    key={tile.id}
                    type="button"
                    onClick={() => vm.onTileActivate(tile.id)}
                    title={vm.tileActionLabel(tile.id)}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-primary/5 transition-colors"
                  >
                    <Icon className={`w-4 h-4 shrink-0 ${TONE_TEXT[tile.tone]}`} />
                    <span className="typo-body text-foreground flex-1 min-w-0 truncate">{tile.label}</span>
                    <span className={`typo-caption capitalize ${TONE_TEXT[tile.tone]}`}>{toneWord(tile.tone)}</span>
                    <span className={`typo-data-lg tabular-nums leading-none w-14 text-right ${TONE_TEXT[tile.tone]}`}>{tile.value}</span>
                    <ChevronRight className="w-3.5 h-3.5 text-foreground shrink-0" />
                  </button>
                );
              })}
            </div>
          </section>

          {/* ===== Integrations — prose lines ===== */}
          <section>
            <h3 className="typo-label text-foreground mb-2">CONNECTIONS</h3>
            <div className="rounded-card border border-primary/10 bg-card/30 divide-y divide-primary/5">
              <IntegrationLine
                icon={Code2}
                title={isGitLab ? 'GitLab' : 'GitHub'}
                state={repoState}
                sentence={
                  repoLinked && repoStats
                    ? `Connected · ${repoStats.defaultBranch}${repoStats.lastPushAt ? ` · pushed ${relTime(repoStats.lastPushAt)}` : ''}`
                    : repoState === 'unmapped' ? 'Credential found — set the repo URL on this project'
                      : repoState === 'empty' ? 'No GitHub or GitLab credential linked'
                        : repoState === 'loading' ? 'Loading…' : 'Not linked'
                }
                onClick={repoState === 'empty' ? vm.gotoConnections : vm.gotoProjects}
              />
              <IntegrationLine
                icon={Shield}
                title="Sentry"
                brandColor="text-red-400"
                state={monitorState}
                sentence={
                  monitorLinked && monitorStats
                    ? `Connected · ${monitorStats.unresolvedIssues} unresolved · ${splitSentrySlug(activeProject.monitoring_project_slug)[1] ?? '—'}${monitoringCred ? ` · ${monitoringCred.name}` : ''}`
                    : monitorState === 'unmapped' ? 'Credential found — link a Sentry project'
                      : monitorState === 'empty' ? 'No Sentry credential linked'
                        : monitorState === 'loading' ? 'Loading…' : 'Not linked'
                }
                onClick={monitorState === 'empty' ? vm.gotoConnections : vm.gotoProjects}
              />
            </div>
          </section>

          {/* ===== Today ===== */}
          {todayActivity.length > 0 && (
            <section>
              <div className="flex items-baseline justify-between mb-2">
                <h3 className="typo-label text-foreground">{po.today_activity_heading}</h3>
                <span className="typo-caption text-foreground tabular-nums">{todayActivity.length}</span>
              </div>
              <ol className="rounded-card border border-primary/10 bg-card/30 divide-y divide-primary/5 max-h-72 overflow-y-auto">
                {todayActivity.map((event) => {
                  const meta = ACTIVITY_META[event.kind];
                  const Icon = meta.icon;
                  return (
                    <li key={event.id}>
                      <button
                        type="button"
                        onClick={() => vm.onActivityJump(event)}
                        className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left hover:bg-primary/5 transition-colors"
                      >
                        <Icon className={`w-3.5 h-3.5 shrink-0 ${meta.tint}`} />
                        <span className="typo-body text-foreground flex-1 min-w-0 truncate">{event.label}</span>
                        <span className="typo-caption text-foreground tabular-nums shrink-0">{relTime(event.timestamp)}</span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </section>
          )}

          {/* ===== Delivery pipeline (read-only) ===== */}
          <section>
            <h3 className="typo-label text-foreground mb-2">{po.pipeline_heading}</h3>
            <div className="rounded-card border border-primary/10 bg-card/20 p-4">
              <EditableProjectPipeline
                project={activeProject}
                teams={teams}
                credentials={credentials}
                onSaved={refresh}
              />
            </div>
            <StandardsScanCard projectId={activeProjectId} />
          </section>
        </div>
      </ContentBody>
    </ContentBox>
  );
}

// ---------------------------------------------------------------------------
// IntegrationLine — one prose row describing an integration's live state.
// ---------------------------------------------------------------------------

function IntegrationLine({
  icon: Icon, title, brandColor = 'text-foreground', state, sentence, onClick,
}: {
  icon: typeof Code2;
  title: string;
  brandColor?: string;
  state: string;
  sentence: string;
  onClick: () => void;
}) {
  const StatusIcon = state === 'connected' ? CheckCircle2
    : state === 'loading' ? RefreshCw
      : state === 'error' ? AlertCircle
        : Key;
  const statusTone = state === 'connected' ? 'text-status-success'
    : state === 'loading' ? 'text-foreground animate-spin'
      : state === 'error' ? 'text-status-error'
        : 'text-status-warning';
  const actionable = state === 'empty' || state === 'unmapped';
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <Icon className={`w-5 h-5 shrink-0 ${brandColor}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="typo-title text-foreground">{title}</span>
          <StatusIcon className={`w-3.5 h-3.5 ${statusTone}`} />
        </div>
        <p className="typo-caption text-foreground truncate">{sentence}</p>
      </div>
      {actionable && (
        <button
          type="button"
          onClick={onClick}
          className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-interactive border border-primary/15 typo-caption text-foreground hover:bg-primary/10 transition-colors"
        >
          <GitBranch className="w-3 h-3" /> Link
        </button>
      )}
    </div>
  );
}
