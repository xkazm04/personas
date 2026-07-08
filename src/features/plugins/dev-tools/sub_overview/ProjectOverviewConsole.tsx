/**
 * Overview variant — "Console".
 *
 * Metaphor: a mission-control bento board. Everything the operator needs sits
 * in one dense 2-D layout with minimal scrolling: a pulse strip up top, the six
 * vitals as shared StatCards in a grid, the delivery pipeline below, and a right
 * rail carrying live connections + the "today" feed. Where the baseline stacks
 * full-width sections vertically, the Console packs them side-by-side so the
 * whole project state is glanceable at once.
 */
import {
  LayoutDashboard, RefreshCw, Code2, Shield, CheckCircle2, AlertCircle, Key,
} from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { StatCard } from '@/features/shared/components/display/StatCard';
import { useTranslation } from '@/i18n/useTranslation';
import { LifecycleProjectPicker } from '../sub_lifecycle/LifecycleProjectPicker';
import { EditableProjectPipeline } from './EditableProjectPipeline';
import { StandardsScanCard } from './StandardsScanCard';
import { splitSentrySlug } from './adapters';
import { useOverviewViewModel, toStatTone } from './overviewViewModel';
import { HealthDot, TONE_TEXT, TONE_BG, TONE_DOT, ACTIVITY_META, relTime } from './overviewShared';

export default function ProjectOverviewConsole() {
  const { t } = useTranslation();
  const po = t.project_overview;
  const vm = useOverviewViewModel();
  const {
    activeProject, activeProjectId, teams, credentials, tiles, verdict, overallTone,
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

      <ContentBody>
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-4">
          {/* ================= Main column ================= */}
          <div className="space-y-4 min-w-0">
            {/* Pulse strip */}
            <div className={`rounded-card border ${TONE_BG[overallTone]} px-4 py-3 flex items-center gap-3`}>
              <HealthDot tone={verdict.tone} size={14} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`typo-heading-lg ${TONE_TEXT[verdict.tone]}`}>{verdict.headline}</span>
                  {lastLoadedAt && (
                    <span className="typo-caption text-foreground hidden sm:inline">
                      · {po.vital_updated_label}{' '}
                      <RelativeTime timestamp={lastLoadedAt} className="tabular-nums" />
                    </span>
                  )}
                </div>
                <p className="typo-caption text-foreground truncate">{verdict.detail}</p>
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

            {/* Vitals — shared StatCards */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {tiles.map((tile) => (
                <button
                  key={tile.id}
                  type="button"
                  onClick={() => vm.onTileActivate(tile.id)}
                  className="text-left rounded-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  <StatCard
                    label={tile.label}
                    value={tile.loading ? '…' : tile.value}
                    icon={tile.icon}
                    tone={toStatTone(tile.tone)}
                    tooltip={vm.tileActionLabel(tile.id)}
                  />
                </button>
              ))}
            </div>

            {/* Delivery pipeline */}
            <div>
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
            </div>
          </div>

          {/* ================= Right rail ================= */}
          <div className="space-y-4 min-w-0">
            {/* Connections */}
            <div className="rounded-card border border-primary/10 bg-card/30 overflow-hidden">
              <div className="px-4 py-2.5 border-b border-primary/10">
                <h3 className="typo-label text-foreground">CONNECTIONS</h3>
              </div>
              <div className="divide-y divide-primary/5">
                <RailConnection
                  icon={Code2}
                  title={isGitLab ? 'GitLab' : 'GitHub'}
                  state={repoState}
                  meta={
                    repoLinked && repoStats
                      ? `${repoStats.defaultBranch}${repoStats.lastPushAt ? ` · ${relTime(repoStats.lastPushAt)}` : ''}`
                      : repoState === 'unmapped' ? 'needs repo URL'
                        : repoState === 'empty' ? 'no credential' : ''
                  }
                  onClick={repoState === 'empty' ? vm.gotoConnections : vm.gotoProjects}
                />
                <RailConnection
                  icon={Shield}
                  brandColor="text-red-400"
                  title="Sentry"
                  state={monitorState}
                  meta={
                    monitorLinked && monitorStats
                      ? `${monitorStats.unresolvedIssues} unresolved · ${splitSentrySlug(activeProject.monitoring_project_slug)[1] ?? monitoringCred?.name ?? '—'}`
                      : monitorState === 'unmapped' ? 'needs project link'
                        : monitorState === 'empty' ? 'no credential' : ''
                  }
                  onClick={monitorState === 'empty' ? vm.gotoConnections : vm.gotoProjects}
                />
              </div>
            </div>

            {/* Today feed */}
            <div className="rounded-card border border-primary/10 bg-card/30 overflow-hidden">
              <div className="px-4 py-2.5 border-b border-primary/10 flex items-baseline justify-between">
                <h3 className="typo-label text-foreground">{po.today_activity_heading}</h3>
                <span className="typo-caption text-foreground tabular-nums">{todayActivity.length}</span>
              </div>
              {todayActivity.length === 0 ? (
                <p className="typo-caption text-foreground px-4 py-6 text-center">{po.today_activity_heading}: —</p>
              ) : (
                <ol className="divide-y divide-primary/5 max-h-[22rem] overflow-y-auto">
                  {todayActivity.map((event) => {
                    const meta = ACTIVITY_META[event.kind];
                    const Icon = meta.icon;
                    return (
                      <li key={event.id}>
                        <button
                          type="button"
                          onClick={() => vm.onActivityJump(event)}
                          className="w-full flex items-center gap-2 px-4 py-2 text-left hover:bg-primary/5 transition-colors"
                        >
                          <Icon className={`w-3.5 h-3.5 shrink-0 ${meta.tint}`} />
                          <span className="typo-caption text-foreground flex-1 min-w-0 truncate">{event.label}</span>
                          <span className="typo-caption tabular-nums shrink-0">{relTime(event.timestamp)}</span>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          </div>
        </div>
      </ContentBody>
    </ContentBox>
  );
}

// ---------------------------------------------------------------------------
// RailConnection — compact one-line connection status for the right rail.
// ---------------------------------------------------------------------------

function RailConnection({
  icon: Icon, title, brandColor = 'text-foreground', state, meta, onClick,
}: {
  icon: typeof Code2;
  title: string;
  brandColor?: string;
  state: string;
  meta: string;
  onClick: () => void;
}) {
  const dot = state === 'connected' ? TONE_DOT.success
    : state === 'error' ? TONE_DOT.error
      : state === 'loading' ? TONE_DOT.info
        : TONE_DOT.warning;
  const StatusIcon = state === 'connected' ? CheckCircle2
    : state === 'error' ? AlertCircle
      : state === 'loading' ? RefreshCw : Key;
  const actionable = state === 'empty' || state === 'unmapped';
  const inner = (
    <div className="flex items-center gap-2.5 px-4 py-3">
      <Icon className={`w-4 h-4 shrink-0 ${brandColor}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="typo-title text-foreground">{title}</span>
          <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
        </div>
        {meta && <p className="typo-caption text-foreground truncate">{meta}</p>}
      </div>
      {!actionable && <StatusIcon className={`w-3.5 h-3.5 shrink-0 ${state === 'loading' ? 'text-foreground animate-spin' : 'text-foreground/50'}`} />}
    </div>
  );
  return actionable ? (
    <button type="button" onClick={onClick} className="w-full text-left hover:bg-primary/5 transition-colors">
      {inner}
    </button>
  ) : inner;
}
