/**
 * Shared view-model for the dev-tools Overview page.
 *
 * Hoists every derivation the Overview needs — connection tones, the six
 * vital-sign tiles, the plain-language health verdict, the cross-tab "today"
 * feed, and the deep-link handlers — out of any single layout so directional
 * variants (Briefing, Console, …) all render from ONE source of truth and stay
 * byte-for-byte consistent in the numbers they show. Only the composition
 * differs between variants; the facts come from here.
 */
import { useEffect, useMemo, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  CircleDot, GitPullRequest, GitCommitHorizontal, Bug, Activity, BarChart3,
} from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { usePipelineStore } from '@/stores/pipelineStore';
import { useTranslation } from '@/i18n/useTranslation';
import { open as openExternal } from '@tauri-apps/plugin-shell';
import { sanitizeExternalUrl } from '@/lib/utils/sanitizers/sanitizeUrl';
import { silentCatch } from '@/lib/silentCatch';
import type { StatTone } from '@/features/shared/components/display/StatCard';
import type { PersonaTeam } from '@/lib/bindings/PersonaTeam';
import { useOverviewData, type OverviewData } from './useOverviewData';
import { buildTodayActivity, type ActivityEvent } from './overviewHelpers';

export type OverviewTone = 'success' | 'warning' | 'error' | 'info' | 'neutral';
export type OverviewTileId =
  | 'open_issues' | 'open_prs' | 'commits' | 'unresolved' | 'events_24h' | 'events_7d';

const REPO_TILE_IDS: OverviewTileId[] = ['open_issues', 'open_prs', 'commits'];

export interface OverviewTile {
  id: OverviewTileId;
  icon: LucideIcon;
  value: string | number;
  /** Present when a real number landed — drives "is this a live stat?" styling. */
  hasValue: boolean;
  label: string;
  tone: OverviewTone;
  loading: boolean;
  isRepo: boolean;
}

export interface OverviewVerdict {
  tone: OverviewTone;
  /** Plain-language health word (Healthy / Needs attention / Critical / …). */
  headline: string;
  /** One-line supporting clause, e.g. "Both sources linked · last push 2h ago". */
  detail: string;
}

/** Map an Overview tone onto the shared StatCard tone vocabulary. */
export function toStatTone(tone: OverviewTone): StatTone {
  return tone === 'error' ? 'danger' : tone;
}

export interface OverviewViewModel extends OverviewData {
  /** Teams roster (resolves the pipeline's bound-team name). */
  teams: PersonaTeam[];
  tiles: OverviewTile[];
  tones: {
    issue: OverviewTone; pr: OverviewTone; commits: OverviewTone;
    unresolved: OverviewTone; events24: OverviewTone; events7: OverviewTone;
  };
  overallTone: OverviewTone;
  verdict: OverviewVerdict;
  repoLinked: boolean;
  monitorLinked: boolean;
  isGitLab: boolean;
  monitoringCred: OverviewData['credentials'][number] | null;
  todayActivity: ActivityEvent[];
  lastLoadedAt: number | null;
  statsLoading: boolean;
  onTileActivate: (id: OverviewTileId) => void;
  tileActionLabel: (id: OverviewTileId) => string;
  onActivityJump: (event: ActivityEvent) => void;
  gotoConnections: () => void;
  gotoProjects: () => void;
}

export function useOverviewViewModel(): OverviewViewModel {
  const { t } = useTranslation();
  const po = t.project_overview;
  const data = useOverviewData();
  const {
    activeProjectId, activeProject, credentials, repoState, repoStats, repoProvider,
    monitorState, monitorStats,
  } = data;

  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);
  const setDevToolsTab = useSystemStore((s) => s.setDevToolsTab);
  const setPendingTaskFocusId = useSystemStore((s) => s.setPendingTaskFocusId);
  const setPendingGoalSpotlightId = useSystemStore((s) => s.setPendingGoalSpotlightId);

  const teams = usePipelineStore((s) => s.teams);
  const fetchTeamsForPipeline = usePipelineStore((s) => s.fetchTeams);
  useEffect(() => { void fetchTeamsForPipeline(); }, [fetchTeamsForPipeline]);

  const isGitLab = repoProvider === 'gitlab';

  // Threshold-derived tones — answer "is this number good or bad?".
  const issueTone: OverviewTone = !repoStats || repoStats.openIssues === 0 ? 'neutral' : repoStats.openIssues > 50 ? 'error' : 'warning';
  const prTone: OverviewTone = !repoStats || repoStats.openPullRequests === 0 ? 'neutral' : 'info';
  const commitsTone: OverviewTone = !repoStats || repoStats.commitsLastWeek === 0 ? 'warning' : 'success';
  const unresolvedTone: OverviewTone = !monitorStats || monitorStats.unresolvedIssues === 0 ? 'success' : monitorStats.unresolvedIssues > 5 ? 'error' : 'warning';
  const events24Tone: OverviewTone = !monitorStats || monitorStats.eventsLast24h === 0 ? 'success' : monitorStats.eventsLast24h > 100 ? 'error' : 'warning';
  const events7Tone: OverviewTone = !monitorStats || monitorStats.eventsLastWeek === 0 ? 'success' : 'info';

  const repoLinked = repoState === 'connected' && repoStats !== null;
  const monitorLinked = monitorState === 'connected' && monitorStats !== null;

  const overallTone: OverviewTone =
    (issueTone === 'error' || unresolvedTone === 'error' || events24Tone === 'error') ? 'error' :
      (issueTone === 'warning' || commitsTone === 'warning' || unresolvedTone === 'warning' || events24Tone === 'warning') ? 'warning' :
        (repoLinked && monitorLinked) ? 'success' : 'neutral';

  const tiles: OverviewTile[] = [
    { id: 'open_issues', icon: CircleDot, value: repoStats?.openIssues ?? '—', hasValue: !!repoStats, label: po.open_issues, tone: issueTone, loading: repoState === 'loading', isRepo: true },
    { id: 'open_prs', icon: GitPullRequest, value: repoStats?.openPullRequests ?? '—', hasValue: !!repoStats, label: isGitLab ? po.open_mrs : po.open_prs, tone: prTone, loading: repoState === 'loading', isRepo: true },
    { id: 'commits', icon: GitCommitHorizontal, value: repoStats?.commitsLastWeek ?? '—', hasValue: !!repoStats, label: po.commits_this_week, tone: commitsTone, loading: repoState === 'loading', isRepo: true },
    { id: 'unresolved', icon: Bug, value: monitorStats?.unresolvedIssues ?? '—', hasValue: !!monitorStats, label: po.unresolved_issues, tone: unresolvedTone, loading: monitorState === 'loading', isRepo: false },
    { id: 'events_24h', icon: Activity, value: monitorStats?.eventsLast24h ?? '—', hasValue: !!monitorStats, label: po.events_24h, tone: events24Tone, loading: monitorState === 'loading', isRepo: false },
    { id: 'events_7d', icon: BarChart3, value: monitorStats?.eventsLastWeek ?? '—', hasValue: !!monitorStats, label: po.events_7d, tone: events7Tone, loading: monitorState === 'loading', isRepo: false },
  ];

  // Plain-language verdict — the interpretation layer. Copy is prototype-local
  // English; extract to i18n on consolidation.
  const verdict: OverviewVerdict = useMemo(() => {
    const linked = (repoLinked ? 1 : 0) + (monitorLinked ? 1 : 0);
    if (linked === 0) return { tone: 'neutral', headline: 'Not yet connected', detail: 'Link a repo and error monitor to light up this dashboard.' };
    const detailBits: string[] = [];
    if (repoLinked && repoStats) {
      detailBits.push(`${repoStats.openIssues} open issue${repoStats.openIssues === 1 ? '' : 's'}`);
    }
    if (monitorLinked && monitorStats) {
      detailBits.push(`${monitorStats.unresolvedIssues} unresolved error${monitorStats.unresolvedIssues === 1 ? '' : 's'}`);
    }
    const detail = detailBits.join(' · ') || 'Sources linked.';
    if (overallTone === 'error') return { tone: 'error', headline: 'Needs attention', detail };
    if (overallTone === 'warning') return { tone: 'warning', headline: 'Watch closely', detail };
    if (overallTone === 'success') return { tone: 'success', headline: 'Healthy', detail };
    return { tone: 'neutral', headline: 'Steady', detail };
  }, [repoLinked, monitorLinked, repoStats, monitorStats, overallTone]);

  const monitoringCred = activeProject?.monitoring_credential_id
    ? credentials.find((c) => c.id === activeProject.monitoring_credential_id) ?? null
    : null;

  // Last-settled marker for a live "updated Nm ago" label.
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(null);
  useEffect(() => {
    if (repoStats || monitorStats) setLastLoadedAt(Date.now());
  }, [repoStats, monitorStats]);
  const statsLoading = repoState === 'loading' || monitorState === 'loading';

  // Cross-tab "today" feed — pulled from the same slices as Scanner/Triage/Tasks.
  const storeScans = useSystemStore((s) => s.scans ?? []);
  const storeTasks = useSystemStore((s) => s.tasks);
  const storeSignals = useSystemStore((s) => s.goalSignals);
  const fetchScans = useSystemStore((s) => s.fetchScans);
  const fetchTasks = useSystemStore((s) => s.fetchTasks);
  useEffect(() => {
    if (!activeProjectId) return;
    fetchScans(activeProjectId);
    fetchTasks(activeProjectId);
  }, [activeProjectId, fetchScans, fetchTasks]);
  const todayActivity = useMemo(
    () => buildTodayActivity(storeScans, storeTasks, storeSignals),
    [storeScans, storeTasks, storeSignals],
  );

  const onActivityJump = (event: ActivityEvent) => {
    if (!event.sourceId) {
      if (event.kind === 'scan_run') setDevToolsTab('idea-scanner');
      return;
    }
    if (event.kind === 'task_created' || event.kind === 'task_completed' || event.kind === 'task_failed') {
      setPendingTaskFocusId(event.sourceId);
      setDevToolsTab('task-runner');
    } else if (event.kind === 'goal_signal') {
      setPendingGoalSpotlightId(event.sourceId);
      setDevToolsTab('goals');
    } else if (event.kind === 'scan_run') {
      setDevToolsTab('idea-scanner');
    }
  };

  const onTileActivate = (id: OverviewTileId) => {
    if (REPO_TILE_IDS.includes(id)) {
      if (repoLinked && activeProject?.github_url) {
        const sub = id === 'open_issues'
          ? (isGitLab ? '/-/issues' : '/issues')
          : id === 'open_prs'
            ? (isGitLab ? '/-/merge_requests' : '/pulls')
            : (isGitLab ? '/-/commits' : '/commits');
        const safe = sanitizeExternalUrl(activeProject.github_url.replace(/\/+$/, '') + sub);
        if (safe) void openExternal(safe).catch(silentCatch('overviewViewModel:openRepoTile'));
      } else if (repoState === 'empty') {
        setSidebarSection('credentials');
      } else {
        setDevToolsTab('projects');
      }
      return;
    }
    if (monitorState === 'empty') setSidebarSection('credentials');
    else setDevToolsTab('overview');
  };

  const tileActionLabel = (id: OverviewTileId): string => {
    if (REPO_TILE_IDS.includes(id)) return repoLinked && activeProject?.github_url ? po.vital_jump_repo : po.vital_jump_setup;
    return monitorState === 'empty' ? po.vital_jump_setup : po.vital_jump_monitor;
  };

  return {
    ...data,
    teams,
    tiles,
    tones: { issue: issueTone, pr: prTone, commits: commitsTone, unresolved: unresolvedTone, events24: events24Tone, events7: events7Tone },
    overallTone,
    verdict,
    repoLinked,
    monitorLinked,
    isGitLab,
    monitoringCred,
    todayActivity,
    lastLoadedAt,
    statsLoading,
    onTileActivate,
    tileActionLabel,
    onActivityJump,
    gotoConnections: () => setSidebarSection('credentials'),
    gotoProjects: () => setDevToolsTab('projects'),
  };
}
