import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { Terminal as TerminalIcon } from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { useSystemStore } from '@/stores/systemStore';
import { gcTerminals } from '../fleetTerminalManager';
import { useFleetTerminalConfig } from '../useFleetTerminalConfig';
import { useFleetOverlayActions } from '../useFleetOverlayActions';
import { SkillLibraryDrawer } from '../SkillLibraryDrawer';
import { FleetBroadcastModal } from '../FleetBroadcastModal';
import { FleetHarvestPanel } from '../sub_harvest/FleetHarvestPanel';
import { FleetNeedsYouBanner } from '../FleetNeedsYouBanner';
import { useFleetHotkeys } from '../useFleetHotkeys';
import { FleetHotkeysHelp } from '../FleetHotkeysHelp';
import { FleetSpawnTaskModal } from '../FleetSpawnTaskModal';
import { FleetSummaryPills } from '../FleetSummaryPills';
import { fleetStateCounts } from '../fleetStateMeta';
import { useTranslation } from '@/i18n/useTranslation';
import { debtText } from '@/i18n/DebtText';
import { FleetGridHeaderActions } from './FleetGridHeaderActions';
import { FleetGridToolbar } from './FleetGridToolbar';
import { FleetSessionList } from './FleetSessionList';
import { FleetFocusPane } from './FleetFocusPane';
import type { FleetRightView } from './FleetPaneToolbar';
import { useFleetGridListeners } from './useFleetGridListeners';
import { useFleetGridNavigation } from './useFleetGridNavigation';
import { useFleetGridSessionOps } from './useFleetGridSessionOps';

/**
 * Sessions view: the Fleet tab the user works in (Settings keeps uninstall +
 * diagnostics). Header (project, count, alert/shortcut/hooks controls), the
 * state pills, the Needs-you banner, one band with the token glance and the
 * actions, then the session list (left) beside the focused session's pane.
 *
 * The body fills the viewport: the list scrolls inside its column and the
 * pane takes the height left under the bands, so a terminal is as tall as the
 * window at any session count (it tracked the list's length before).
 *
 * Scale notes for 5-10 parallel CLIs: sessions are read with useShallow and
 * FleetSessionCard is memoised, so a patch to one session re-renders one row;
 * only the focused session mounts an xterm and subscribes to live output.
 */
export default function FleetGridPage() {
  const refresh = useSystemStore((s) => s.fleetRefresh);
  const removeLocal = useSystemStore((s) => s.fleetRemoveSessionLocal);
  const gridOpen = useSystemStore((s) => s.fleetGridOpen);
  const setGridOpen = useSystemStore((s) => s.fleetSetGridOpen);
  const {
    sessions, liveSessions, activeSessionId, setActiveSession, selectSession,
    activeProject, spawning, handleSpawn, handleApplySkill,
  } = useFleetOverlayActions();
  const { t, tx } = useTranslation();

  // Persisted terminal settings applied to every live terminal.
  useFleetTerminalConfig();
  useFleetGridListeners(sessions);
  const ops = useFleetGridSessionOps(sessions, activeProject, setActiveSession);
  const nav = useFleetGridNavigation(sessions, activeSessionId, setActiveSession);

  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [harvestOpen, setHarvestOpen] = useState(false);
  const [spawnTaskOpen, setSpawnTaskOpen] = useState(false);
  const [rightView, setRightView] = useState<FleetRightView>('terminal');
  const [skillsDrawerOpen, setSkillsDrawerOpen] = useState(false);
  const [hotkeysHelpOpen, setHotkeysHelpOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // Selection is wake-aware: activating a dozing or hibernated session resumes it.
  const handleActivate = useCallback((id: string) => void selectSession(id), [selectSession]);
  const handleRemovedLocal = useCallback((id: string) => removeLocal(id), [removeLocal]);

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) ?? null,
    [sessions, activeSessionId],
  );
  // Unbound (Spawning) sessions have no transcript to aggregate.
  const boundClaudeIds = useMemo(
    () => sessions.map((s) => s.claudeSessionId).filter((id): id is string => !!id),
    [sessions],
  );
  const stateCounts = useMemo(() => fleetStateCounts(sessions), [sessions]);

  // Reap managed terminals whose session left the registry (never on unmount).
  useEffect(() => {
    gcTerminals(new Set(sessions.map((s) => s.id)));
  }, [sessions]);

  const handleToggleGrid = useCallback(() => {
    if (gridOpen) setGridOpen(false);
    else if (liveSessions.length > 0) setGridOpen(true);
  }, [gridOpen, liveSessions.length, setGridOpen]);

  useFleetHotkeys(!broadcastOpen && !skillsDrawerOpen && !hotkeysHelpOpen, gridOpen, {
    onNextWaiting: nav.handleCycleNext,
    onMoveFocus: nav.handleMoveFocus,
    onFocusSearch: () => searchRef.current?.focus(),
    onToggleGrid: handleToggleGrid,
    onShowHelp: () => setHotkeysHelpOpen(true),
  });

  const sessionCount = tx(sessions.length === 1 ? t.plugins.fleet.sessions_one : t.plugins.fleet.sessions_other, { count: sessions.length });

  return (
    <ContentBox>
      <ContentHeader
        icon={<TerminalIcon className="w-5 h-5 text-primary" />}
        title={debtText("auto_fleet_sessions_691c1118")}
        subtitle={activeProject ? `${activeProject.name} · ${sessionCount}` : t.plugins.fleet.no_project_hint}
        actions={<FleetGridHeaderActions onShowHotkeys={() => setHotkeysHelpOpen(true)} />}
      />
      <ContentBody flex>
        {/* ContentBody's own padding, on a column the grid below can fill. A dense
            tool surface: compact type density (typography.css). */}
        <div data-type-density="compact" className="flex-1 min-h-0 flex flex-col py-4 md:py-6 xl:py-8 px-3 md:px-4 xl:px-5">
          <div data-testid="fleet-grid-page" />
          <FleetSummaryPills counts={stateCounts} activeFilter={nav.filter} onToggle={nav.toggleFilter} />
          <FleetNeedsYouBanner waiting={nav.waitingSessions} onJump={handleActivate} onReply={ops.handleReply} onCycleNext={nav.handleCycleNext} />
          <FleetGridToolbar
            sessions={sessions}
            liveCount={liveSessions.length}
            waitingCount={nav.waitingSessions.length}
            boundClaudeIds={boundClaudeIds}
            activeProject={activeProject}
            spawning={spawning}
            onOpenGrid={() => setGridOpen(true)}
            onSpawn={handleSpawn}
            onSpawnTask={() => setSpawnTaskOpen(true)}
            onBroadcast={() => setBroadcastOpen(true)}
            onHarvest={() => setHarvestOpen(true)}
            onRefresh={refresh}
          />
          <div className="flex-1 min-h-[400px] grid grid-cols-[minmax(18rem,24rem)_minmax(0,1fr)] gap-3">
            <FleetSessionList
              sessions={sessions}
              groups={nav.groups}
              activeSessionId={activeSessionId}
              hasProject={!!activeProject}
              query={nav.query}
              onQuery={nav.setQuery}
              searchRef={searchRef}
              onActivate={handleActivate}
              onRemovedLocal={handleRemovedLocal}
            />
            <div className="min-h-0">
              <FleetFocusPane
                session={activeSession}
                gridOpen={gridOpen}
                view={rightView}
                onView={setRightView}
                onCompact={ops.handleCompact}
                onOpenSkills={() => setSkillsDrawerOpen(true)}
                onHibernate={ops.handleHibernate}
                onWake={ops.handleWake}
              />
            </div>
          </div>
        </div>
      </ContentBody>

      <FleetBroadcastModal open={broadcastOpen} onClose={() => setBroadcastOpen(false)} />
      <FleetHarvestPanel open={harvestOpen} onClose={() => setHarvestOpen(false)} />
      <FleetHotkeysHelp open={hotkeysHelpOpen} onClose={() => setHotkeysHelpOpen(false)} />
      {activeProject && (
        <FleetSpawnTaskModal
          open={spawnTaskOpen}
          onClose={() => setSpawnTaskOpen(false)}
          projectPath={activeProject.root_path}
          onSpawn={ops.handleSpawnWithTask}
        />
      )}
      <SkillLibraryDrawer
        open={skillsDrawerOpen}
        onClose={() => setSkillsDrawerOpen(false)}
        onApply={handleApplySkill}
        targetLabel={activeSession ? (activeSession.name ?? activeSession.projectLabel) : null}
      />
    </ContentBox>
  );
}
