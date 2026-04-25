import { useState, useEffect, useCallback, useMemo } from 'react';
import { Map, Plus, Search } from 'lucide-react';
import { listen } from '@tauri-apps/api/event';
import { invokeWithTimeout as invoke } from '@/lib/tauriInvoke';
import { EventName } from '@/lib/eventRegistry';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { ActionRow } from '@/features/shared/components/layout/ActionRow';
import { Button } from '@/features/shared/components/buttons';
import { useDevToolsActions } from '../hooks/useDevToolsActions';
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

function finalizeContextScan(args: ContextScanFinalize, clearLines: () => void) {
  const { outcome, groupsCreated, contextsCreated, filesMapped, errorMessage } = args;
  const pid = useSystemStore.getState().activeProjectId;
  const projectName = pid
    ? useSystemStore.getState().projects.find((p) => p.id === pid)?.name ?? 'Unknown project'
    : 'Unknown project';

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
      groupsCreated != null ? `${groupsCreated} groups` : null,
      contextsCreated != null ? `${contextsCreated} contexts` : null,
      filesMapped != null ? `${filesMapped} files` : null,
    ].filter(Boolean).join(', ');
    center.addProcessNotification({
      processType: 'context-scan',
      status: 'success',
      title: `Context Map Ready — ${projectName}`,
      summary: counts ? `Generated ${counts}.` : 'Codebase scan completed successfully.',
      redirectSection: 'plugins',
      redirectTab: 'context-map',
    });
  } else if (outcome === 'warning') {
    const counts = [
      groupsCreated != null ? `${groupsCreated} groups` : null,
      contextsCreated != null ? `${contextsCreated} contexts` : null,
    ].filter(Boolean).join(', ');
    center.addProcessNotification({
      processType: 'context-scan',
      status: 'warning',
      title: `Context Map (partial) — ${projectName}`,
      summary: `Scan exceeded the timeout but ${counts || 'partial results'} were saved. Click Open to review what was generated.`,
      redirectSection: 'plugins',
      redirectTab: 'context-map',
    });
  } else {
    center.addProcessNotification({
      processType: 'context-scan',
      status: 'failed',
      title: `Context Map Failed — ${projectName}`,
      summary: errorMessage ?? 'The codebase scan failed before any contexts were created. Try again or check the logs.',
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
  const { t } = useTranslation();
  const { fetchContextMap, createContextGroup, scanCodebase } = useDevToolsActions();

  const storeGroups = useSystemStore((s) => s.contextGroups);
  const storeContexts = useSystemStore((s) => s.contexts);
  const activeScanId = useSystemStore((s) => s.activeScanId);
  const activeProject = useSystemStore((s) =>
    s.projects.find((p) => p.id === s.activeProjectId),
  );

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
        name: 'Ungrouped',
        color: 'amber',
        contexts: ungrouped.map((c) => toItem(c, '__ungrouped__')),
      });
    }

    return result;
  }, [storeGroups, storeContexts]);

  // Listen for Tauri streaming events — registered ONCE on mount.
  // Reads activeScanId from the store at event time so the listener is stable
  // across re-renders (avoids the unstable useDevToolsActions dependency bug).
  useEffect(() => {
    let outputUnlisten: (() => void) | null = null;
    let statusUnlisten: (() => void) | null = null;
    let completeUnlisten: (() => void) | null = null;

    listen<{ job_id: string; line: string }>(EventName.CONTEXT_GEN_OUTPUT, (event) => {
      const currentScanId = useSystemStore.getState().activeScanId;
      if (currentScanId && event.payload.job_id === currentScanId) {
        setScanLines((prev) => [...prev, event.payload.line]);
      }
    }).then((fn) => { outputUnlisten = fn; });

    listen<{ job_id: string; status: string; error?: string }>(EventName.CONTEXT_GEN_STATUS, (event) => {
      const currentScanId = useSystemStore.getState().activeScanId;
      if (currentScanId && event.payload.job_id === currentScanId) {
        const { status, error } = event.payload;
        if (status === 'completed') {
          // Wait for CONTEXT_GEN_COMPLETE which carries the summary counts.
          // If it never arrives within 3s, finalize without counts.
          setTimeout(() => {
            if (useSystemStore.getState().activeScanId === currentScanId) {
              finalizeContextScan({ outcome: 'success' }, () => setScanLines([]));
            }
          }, 3000);
        } else if (status === 'completed_with_warning') {
          setTimeout(() => {
            if (useSystemStore.getState().activeScanId === currentScanId) {
              finalizeContextScan({ outcome: 'warning', errorMessage: error }, () => setScanLines([]));
            }
          }, 3000);
        } else if (status === 'failed' || status === 'cancelled') {
          finalizeContextScan({ outcome: 'failed', errorMessage: error }, () => setScanLines([]));
        }
      }
    }).then((fn) => { statusUnlisten = fn; });

    // Primary completion event — carries the summary counts.
    listen<{
      scan_id: string;
      groups_created?: number;
      contexts_created?: number;
      files_mapped?: number;
      status?: string;
      error?: string;
    }>(EventName.CONTEXT_GEN_COMPLETE, (event) => {
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
        );
      }
    }).then((fn) => { completeUnlisten = fn; });

    return () => {
      outputUnlisten?.();
      statusUnlisten?.();
      completeUnlisten?.();
    };
  }, []); // empty deps — register once on mount

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
          finalizeContextScan({ outcome: 'success' }, () => setScanLines([]));
        } else if (result.status === 'completed_with_warning') {
          finalizeContextScan({ outcome: 'warning', errorMessage: result.error }, () => setScanLines([]));
        } else if (result.status === 'failed' || result.status === 'cancelled' || result.status === 'not_found') {
          finalizeContextScan({ outcome: 'failed', errorMessage: result.error }, () => setScanLines([]));
        }
        // else: still running — listener will catch the event
      } catch { /* ignore */ }
    })();

    return () => { cancelled = true; };
  }, []);

  useEffect(() => { fetchContextMap(); }, []);

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
      title: `Context Map Cancelled${activeProject?.name ? ` — ${activeProject.name}` : ''}`,
      summary: 'Codebase scan was cancelled by the user.',
      redirectSection: 'plugins',
      redirectTab: 'context-map',
    });
    useSystemStore.setState({ codebaseScanPhase: 'idle', activeScanId: null });
    setScanLines([]);
  }, [activeScanId, activeProject?.name]);

  const handleCreateGroup = (name: string, color: string) => {
    createContextGroup({ name, color });
  };

  const selectedCtx = groups.flatMap((g) => g.contexts).find((c) => c.id === selectedCtxId);

  return (
    <ContentBox>
      <ContentHeader
        icon={<Map className="w-5 h-5 text-amber-400" />}
        iconColor="amber"
        title={t.plugins.dev_tools.context_map_title}
        subtitle={t.plugins.dev_tools.context_map_subtitle}
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
          />

          {selectedCtx && <ContextDetail ctx={selectedCtx} onClose={() => setSelectedCtxId(null)} />}
        </div>
      </ContentBody>

      <ScanOverlay scanning={scanning} lines={scanLines} onCancel={handleCancelScan} />
    </ContentBox>
  );
}
