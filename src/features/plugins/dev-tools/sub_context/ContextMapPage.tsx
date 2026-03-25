import { useState, useEffect, useCallback, useMemo } from 'react';
import { Map, Plus, Search } from 'lucide-react';
import { listen } from '@tauri-apps/api/event';
import { EventName } from '@/lib/eventRegistry';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { Button } from '@/features/shared/components/buttons';
import { useDevToolsActions } from '../hooks/useDevToolsActions';
import { useSystemStore } from '@/stores/systemStore';
import { cancelScanCodebase } from '@/api/devTools/devTools';

import type { ContextGroup, ContextItem } from './contextMapTypes';
import { parseJsonArray } from './contextMapTypes';
import ScanOverlay from './ScanOverlay';
import ContextDetail from './ContextDetail';
import GroupList from './GroupList';

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function ContextMapPage() {
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

  // Listen for Tauri streaming events — survives navigation
  useEffect(() => {
    const outputPromise = listen<{ job_id: string; line: string }>(EventName.CONTEXT_GEN_OUTPUT, (event) => {
      if (activeScanId && event.payload.job_id === activeScanId) {
        setScanLines((prev) => [...prev, event.payload.line]);
      }
    });

    const statusPromise = listen<{ job_id: string; status: string }>(EventName.CONTEXT_GEN_STATUS, (event) => {
      if (activeScanId && event.payload.job_id === activeScanId) {
        const { status } = event.payload;
        if (status === 'completed' || status === 'failed' || status === 'cancelled') {
          if (status === 'completed') fetchContextMap();
          setTimeout(() => {
            useSystemStore.setState({
              codebaseScanPhase: status === 'completed' ? 'complete' : 'error',
              activeScanId: null,
            });
            setScanLines([]);
          }, 1500);
        }
      }
    });

    return () => {
      outputPromise.then((fn) => fn());
      statusPromise.then((fn) => fn());
    };
  }, [activeScanId, fetchContextMap]);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: run once on mount
  useEffect(() => { fetchContextMap(); }, []);

  const handleScan = useCallback(async () => {
    setScanLines([]);
    try { await scanCodebase(activeProject?.root_path); } catch { /* store handles error */ }
  }, [scanCodebase, activeProject?.root_path]);

  const handleCancelScan = useCallback(async () => {
    if (activeScanId) await cancelScanCodebase(activeScanId);
    useSystemStore.setState({ codebaseScanPhase: 'idle', activeScanId: null });
    setScanLines([]);
  }, [activeScanId]);

  const handleCreateGroup = (name: string, color: string) => {
    createContextGroup({ name, color });
  };

  const selectedCtx = groups.flatMap((g) => g.contexts).find((c) => c.id === selectedCtxId);

  return (
    <ContentBox>
      <ContentHeader
        icon={<Map className="w-5 h-5 text-amber-400" />}
        iconColor="amber"
        title="Context Map"
        subtitle="Scan codebases into business-feature contexts"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" icon={<Plus className="w-3.5 h-3.5" />} onClick={() => setShowNewGroup(true)}>Group</Button>
            <Button variant="accent" accentColor="amber" size="sm" icon={<Search className="w-3.5 h-3.5" />} loading={scanning} onClick={handleScan}>Scan Codebase</Button>
          </div>
        }
      />

      <ContentBody>
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
