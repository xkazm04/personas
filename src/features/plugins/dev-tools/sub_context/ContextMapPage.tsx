import { useState, useEffect, useCallback, useMemo } from 'react';
import { Map as MapIcon, Plus, Search } from 'lucide-react';
import type { Event } from '@tauri-apps/api/event';
import { useTauriEvent } from '@/hooks/useTauriEvent';
import { invokeWithTimeout as invoke } from '@/lib/tauriInvoke';
import { EventName } from '@/lib/eventRegistry';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { ActionRow } from '@/features/shared/components/layout/ActionRow';
import { Button } from '@/features/shared/components/buttons';
import { useDevToolsActions } from '../hooks/useDevToolsActions';
import { LifecycleProjectPicker } from '../sub_lifecycle/LifecycleProjectPicker';
import { useSystemStore } from '@/stores/systemStore';
import { cancelScanCodebase } from '@/api/devTools/devTools';
import { useOverviewStore } from '@/stores/overviewStore';
import { useNotificationCenterStore } from '@/stores/notificationCenterStore';

import type { ContextGroup, ContextItem } from './contextMapTypes';
import { parseJsonArray } from './contextMapTypes';
import ScanOverlay from './ScanOverlay';
import ContextDetail from './ContextDetail';
import GroupList from './GroupList';
import { useTranslation } from '@/i18n/useTranslation';
import type { Translations } from '@/i18n/en';
import { silentCatch } from '@/lib/silentCatch';


// ---------------------------------------------------------------------------
// Completion handler — shared by event listener + resync polling.
// Reads everything from the store directly so it has no closure dependencies.
// ---------------------------------------------------------------------------
type ContextScanOutcome = 'success' | 'warning' | 'failed';

interface ContextScanFinalize {
  outcome: ContextScanOutcome;
  groupsCreated?: number;
  contextsCreated?: number;
  filesMapped?: number;
  errorMessage?: string;
}

type TxFn = (template: string, vars: Record<string, string | number>) => string;

function finalizeContextScan(
  args: ContextScanFinalize,
  clearLines: () => void,
  t: Translations,
  tx: TxFn,
) {
  const { outcome, groupsCreated, contextsCreated, filesMapped, errorMessage } = args;
  const dt = t.plugins.dev_tools;
  const pid = useSystemStore.getState().activeProjectId;
  const projectName = pid
    ? useSystemStore.getState().projects.find((p) => p.id === pid)?.name ?? dt.context_scan_unknown_project
    : dt.context_scan_unknown_project;

  // Always re-fetch when there's any chance work was committed (success or warning).
  if ((outcome === 'success' || outcome === 'warning') && pid) {
    useSystemStore.getState().fetchContextGroups(pid).catch(() => {});
    useSystemStore.getState().fetchContexts(pid).catch(() => {});
  }

  // Drawer activity end
  useOverviewStore.getState().processEnded(
    'context_scan',
    outcome === 'failed' ? 'failed' : 'completed',
  );

  // Persistent in-app notification (TitleBar bell)
  const center = useNotificationCenterStore.getState();
  if (outcome === 'success') {
    const counts = [
      groupsCreated != null ? tx(dt.context_scan_count_groups, { count: groupsCreated }) : null,
      contextsCreated != null ? tx(dt.context_scan_count_contexts, { count: contextsCreated }) : null,
      filesMapped != null ? tx(dt.context_scan_count_files, { count: filesMapped }) : null,
    ].filter(Boolean).join(', ');
    center.addProcessNotification({
      processType: 'context-scan',
      status: 'success',
      title: tx(dt.context_scan_notif_ready_title, { projectName }),
      summary: counts ? tx(dt.context_scan_notif_ready_summary, { counts }) : dt.context_scan_notif_ready_summary_default,
      redirectSection: 'plugins',
      redirectTab: 'context-map',
    });
  } else if (outcome === 'warning') {
    const counts = [
      groupsCreated != null ? tx(dt.context_scan_count_groups, { count: groupsCreated }) : null,
      contextsCreated != null ? tx(dt.context_scan_count_contexts, { count: contextsCreated }) : null,
    ].filter(Boolean).join(', ');
    center.addProcessNotification({
      processType: 'context-scan',
      status: 'warning',
      title: tx(dt.context_scan_notif_partial_title, { projectName }),
      summary: tx(dt.context_scan_notif_partial_summary, { counts: counts || dt.context_scan_notif_partial_summary_default }),
      redirectSection: 'plugins',
      redirectTab: 'context-map',
    });
  } else {
    center.addProcessNotification({
      processType: 'context-scan',
      status: 'failed',
      title: tx(dt.context_scan_notif_failed_title, { projectName }),
      summary: errorMessage ?? dt.context_scan_notif_failed_default,
      redirectSection: 'plugins',
      redirectTab: 'context-map',
    });
  }

  setTimeout(() => {
    useSystemStore.setState({
      codebaseScanPhase: outcome === 'failed' ? 'error' : 'complete',
      activeScanId: null,
    });
    clearLines();
  }, 800);
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function ContextMapPage() {
  const { t, tx } = useTranslation();
  const { fetchContextMap, createContextGroup, scanCodebase } = useDevToolsActions();

  const storeGroups = useSystemStore((s) => s.contextGroups);
  const storeContexts = useSystemStore((s) => s.contexts);
  const storeGoals = useSystemStore((s) => s.goals);
  const fetchGoals = useSystemStore((s) => s.fetchGoals);
  const activeScanId = useSystemStore((s) => s.activeScanId);
  const activeProject = useSystemStore((s) =>
    s.projects.find((p) => p.id === s.activeProjectId),
  );
  const activeProjectId = useSystemStore((s) => s.activeProjectId);

  // Ensure goals are loaded so the per-context coverage badge has data even
  // when the user opens ContextMap before ever visiting Lifecycle.
  useEffect(() => {
    if (activeProjectId) fetchGoals(activeProjectId);
  }, [activeProjectId, fetchGoals]);

  // contextId → { count, firstGoalId } so each ContextCard can show its
  // goal-coverage badge and seed the spotlight handoff in one click.
  const goalCoverageByContext = useMemo(() => {
    const map = new Map<string, { count: number; firstGoalId: string }>();
    for (const g of storeGoals) {
      if (!g.context_id) continue;
      const existing = map.get(g.context_id);
      if (existing) existing.count++;
      else map.set(g.context_id, { count: 1, firstGoalId: g.id });
    }
    return map;
  }, [storeGoals]);

  const codebaseScanPhase = useSystemStore((s) => s.codebaseScanPhase);
  const scanning = codebaseScanPhase === 'scanning';

  const [selectedCtxId, setSelectedCtxId] = useState<string | null>(null);
  const [scanLines, setScanLines] = useState<string[]>([]);
  const [showNewGroup, setShowNewGroup] = useState(false);

  const groups = useMemo<ContextGroup[]>(() => {
    const toItem = (c: typeof storeContexts[number], groupId: string): ContextItem => ({
      id: c.id,
      groupId,
      name: c.name,
      description: c.description ?? '',
      filePaths: parseJsonArray(c.file_paths),
      keywords: parseJsonArray(c.keywords),
      entryPoints: parseJsonArray(c.entry_points),
    });

    const result: ContextGroup[] = storeGroups.map((g) => ({
      id: g.id,
      name: g.name,
      color: g.color || 'amber',
      contexts: storeContexts
        .filter((c) => c.group_id === g.id)
        .map((c) => toItem(c, g.id)),
    }));

    const ungrouped = storeContexts.filter((c) => !c.group_id);
    if (ungrouped.length > 0) {
      result.push({
        id: '__ungrouped__',
        name: t.plugins.dev_tools.context_scan_ungrouped,
        color: 'amber',
        contexts: ungrouped.map((c) => toItem(c, '__ungrouped__')),
      });
    }

    return result;
  }, [storeGroups, storeContexts, t]);

  // Listen for Tauri streaming events. Each handler reads activeScanId from
  // the store at event time so it ignores stale jobs without taking the
  // scan id as a closure dependency. Output handler has no language deps;
  // status + complete handlers re-bind on t/tx so mid-scan completion
  // notifications use the active locale.
  const handleScanOutput = useCallback((event: Event<{ job_id: string; line: string }>) => {
    const currentScanId = useSystemStore.getState().activeScanId;
    if (currentScanId && event.payload.job_id === currentScanId) {
      setScanLines((prev) => [...prev, event.payload.line]);
    }
  }, []);
  useTauriEvent<{ job_id: string; line: string }>(EventName.CONTEXT_GEN_OUTPUT, handleScanOutput);

  const handleScanStatus = useCallback(
    (event: Event<{ job_id: string; status: string; error?: string }>) => {
      const currentScanId = useSystemStore.getState().activeScanId;
      if (currentScanId && event.payload.job_id === currentScanId) {
        const { status, error } = event.payload;
        if (status === 'completed') {
          // Wait for CONTEXT_GEN_COMPLETE which carries the summary counts.
          // If it never arrives within 3s, finalize without counts.
          setTimeout(() => {
            if (useSystemStore.getState().activeScanId === currentScanId) {
              finalizeContextScan({ outcome: 'success' }, () => setScanLines([]), t, tx);
            }
          }, 3000);
        } else if (status === 'completed_with_warning') {
          setTimeout(() => {
            if (useSystemStore.getState().activeScanId === currentScanId) {
              finalizeContextScan({ outcome: 'warning', errorMessage: error }, () => setScanLines([]), t, tx);
            }
          }, 3000);
        } else if (status === 'failed' || status === 'cancelled') {
          finalizeContextScan({ outcome: 'failed', errorMessage: error }, () => setScanLines([]), t, tx);
        }
      }
    },
    [t, tx],
  );
  useTauriEvent<{ job_id: string; status: string; error?: string }>(
    EventName.CONTEXT_GEN_STATUS,
    handleScanStatus,
  );

  // Primary completion event — carries the summary counts.
  const handleScanComplete = useCallback(
    (event: Event<{
      scan_id: string;
      groups_created?: number;
      contexts_created?: number;
      files_mapped?: number;
      status?: string;
      error?: string;
    }>) => {
      const currentScanId = useSystemStore.getState().activeScanId;
      if (currentScanId && event.payload.scan_id === currentScanId) {
        const isWarning = event.payload.status === 'completed_with_warning';
        finalizeContextScan(
          {
            outcome: isWarning ? 'warning' : 'success',
            groupsCreated: event.payload.groups_created,
            contextsCreated: event.payload.contexts_created,
            filesMapped: event.payload.files_mapped,
            errorMessage: event.payload.error,
          },
          () => setScanLines([]),
          t,
          tx,
        );
      }
    },
    [t, tx],
  );
  useTauriEvent<{
    scan_id: string;
    groups_created?: number;
    contexts_created?: number;
    files_mapped?: number;
    status?: string;
    error?: string;
  }>(EventName.CONTEXT_GEN_COMPLETE, handleScanComplete);

  // On mount: if a scan is already active in the store, poll its real status.
  // This handles the case where the user navigated away during a scan and
  // came back AFTER it completed (so they missed the completion event).
  useEffect(() => {
    const id = useSystemStore.getState().activeScanId;
    if (!id) return;

    let cancelled = false;
    (async () => {
      try {
        const result = await invoke<{ scan_id: string; status: string; error?: string; lines?: string[] }>(
          'dev_tools_get_scan_codebase_status',
          { scanId: id },
        );
        if (cancelled) return;
        if (result.lines && result.lines.length > 0) {
          setScanLines(result.lines);
        }
        if (result.status === 'completed') {
          finalizeContextScan({ outcome: 'success' }, () => setScanLines([]), t, tx);
        } else if (result.status === 'completed_with_warning') {
          finalizeContextScan({ outcome: 'warning', errorMessage: result.error }, () => setScanLines([]), t, tx);
        } else if (result.status === 'failed' || result.status === 'cancelled' || result.status === 'not_found') {
          finalizeContextScan({ outcome: 'failed', errorMessage: result.error }, () => setScanLines([]), t, tx);
        }
        // else: still running — listener will catch the event
      } catch (err) { silentCatch("features/plugins/dev-tools/sub_context/ContextMapPage:catch1")(err); }
    })();

    return () => { cancelled = true; };
    // Mount-time resync; t/tx flow into finalizeContextScan if a stale scan
    // resolves on first paint. Re-running on language switch is acceptable —
    // the activeScanId guard avoids work when no scan is pending.
  }, [t, tx]);

  useEffect(() => { fetchContextMap(); }, [fetchContextMap]);

  const handleScan = useCallback(async () => {
    setScanLines([]);
    useOverviewStore.getState().processStarted(
      'context_scan',
      undefined,
      `Context Map Scan${activeProject?.name ? ` — ${activeProject.name}` : ''}`,
      { section: 'plugins', tab: 'context-map' },
    );
    try { await scanCodebase(activeProject?.root_path); } catch {
      useOverviewStore.getState().processEnded('context_scan', 'failed');
    }
  }, [scanCodebase, activeProject?.root_path, activeProject?.name]);

  const handleCancelScan = useCallback(async () => {
    if (activeScanId) await cancelScanCodebase(activeScanId);
    useOverviewStore.getState().processEnded('context_scan', 'cancelled');
    useNotificationCenterStore.getState().addProcessNotification({
      processType: 'context-scan',
      status: 'canceled',
      title: tx(t.plugins.dev_tools.context_scan_notif_cancelled_title, {
        projectName: activeProject?.name ?? t.plugins.dev_tools.context_scan_unknown_project,
      }),
      summary: t.plugins.dev_tools.context_scan_notif_cancelled_summary,
      redirectSection: 'plugins',
      redirectTab: 'context-map',
    });
    useSystemStore.setState({ codebaseScanPhase: 'idle', activeScanId: null });
    setScanLines([]);
  }, [activeScanId, activeProject?.name, t, tx]);

  const handleCreateGroup = (name: string, color: string) => {
    createContextGroup({ name, color });
  };

  const selectedCtx = groups.flatMap((g) => g.contexts).find((c) => c.id === selectedCtxId);

  return (
    <ContentBox>
      <ContentHeader
        icon={<MapIcon className="w-5 h-5 text-amber-400" />}
        iconColor="amber"
        title={t.plugins.dev_tools.context_map_title}
        subtitle={activeProject?.root_path ?? t.plugins.dev_tools.context_map_subtitle}
        actions={<LifecycleProjectPicker />}
      />

      <ContentBody>
        <ActionRow>
          <Button variant="secondary" size="sm" icon={<Plus className="w-3.5 h-3.5" />} onClick={() => setShowNewGroup(true)}>{t.plugins.dev_tools.group}</Button>
          <Button variant="accent" accentColor="amber" size="sm" icon={<Search className="w-3.5 h-3.5" />} loading={scanning} onClick={handleScan}>{t.plugins.dev_tools.scan_codebase}</Button>
        </ActionRow>

        <div className="flex gap-0 min-h-0 flex-1">
          <GroupList
            groups={groups}
            selectedCtxId={selectedCtxId}
            onSelectCtx={setSelectedCtxId}
            showNewGroup={showNewGroup}
            onShowNewGroup={setShowNewGroup}
            onCreateGroup={handleCreateGroup}
            onScan={handleScan}
            goalCoverageByContext={goalCoverageByContext}
          />

          {selectedCtx && <ContextDetail ctx={selectedCtx} onClose={() => setSelectedCtxId(null)} />}
        </div>
      </ContentBody>

      <ScanOverlay scanning={scanning} lines={scanLines} onCancel={handleCancelScan} />
    </ContentBox>
  );
}
