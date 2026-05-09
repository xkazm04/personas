import { useEffect, useRef, useState } from 'react';
import { useSystemStore } from '@/stores/systemStore';
import { invokeWithTimeout as invoke } from '@/lib/tauriInvoke';
import { silentCatch } from '@/lib/silentCatch';
import { useTranslation } from '@/i18n/useTranslation';

export interface KbInfo {
  id: string;
  name: string;
  document_count: number;
  chunk_count: number;
  status: string;
}

/**
 * KB binding state machine + handlers shared by every Brain variant
 * (Atelier / Baseline / Console). Was previously duplicated byte-for-byte
 * across all three files (~62 LOC × 3) — drift between copies is the
 * predictable failure mode.
 *
 * Returns everything the variants need: hydrated KB info, list of all KBs
 * (loaded on demand for the picker), per-action loading flags, and the
 * five mutation handlers (refresh/load/create/bind/unbind).
 */
export function useBrainConnection() {
  const t = useTranslation().t.twin;
  const twinProfiles = useSystemStore((s) => s.twinProfiles);
  const activeTwinId = useSystemStore((s) => s.activeTwinId);
  const bindTwinKnowledgeBase = useSystemStore((s) => s.bindTwinKnowledgeBase);
  const unbindTwinKnowledgeBase = useSystemStore((s) => s.unbindTwinKnowledgeBase);
  const fetchTwinProfiles = useSystemStore((s) => s.fetchTwinProfiles);

  const activeTwin = twinProfiles.find((tw) => tw.id === activeTwinId);
  const kbId = activeTwin?.knowledge_base_id ?? null;

  const [kbInfo, setKbInfo] = useState<KbInfo | null>(null);
  const [allKbs, setAllKbs] = useState<KbInfo[]>([]);
  const [kbLoading, setKbLoading] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [pickMode, setPickMode] = useState(false);
  const lastLoadedKbId = useRef<string | null>(null);

  useEffect(() => {
    if (!kbId) { setKbInfo(null); lastLoadedKbId.current = null; return; }
    if (kbId === lastLoadedKbId.current) return;
    lastLoadedKbId.current = kbId;
    setKbLoading(true);
    invoke<KbInfo>('get_knowledge_base', { kbId })
      .then((kb) => setKbInfo(kb))
      .catch(() => setKbInfo(null))
      .finally(() => setKbLoading(false));
  }, [kbId]);

  const refreshKb = () => {
    if (!kbId) return;
    lastLoadedKbId.current = null;
    setKbLoading(true);
    invoke<KbInfo>('get_knowledge_base', { kbId })
      .then((kb) => { setKbInfo(kb); lastLoadedKbId.current = kbId; })
      .catch(() => setKbInfo(null))
      .finally(() => setKbLoading(false));
  };

  const loadAllKbs = async () => {
    try { setAllKbs(await invoke<KbInfo[]>('list_knowledge_bases')); } catch { setAllKbs([]); }
  };

  const handleCreateKb = async () => {
    if (!activeTwinId || !activeTwin) return;
    setCreating(true);
    setCreateError(null);
    try {
      const kb = await invoke<KbInfo>('create_knowledge_base', {
        name: `${activeTwin.name} Brain`,
        description: `Knowledge base for twin: ${activeTwin.name}`,
      });
      await bindTwinKnowledgeBase(activeTwinId, kb.id);
      await fetchTwinProfiles();
      setKbInfo(kb);
      lastLoadedKbId.current = kb.id;
    } catch (err) {
      const msg = typeof err === 'object' && err !== null && 'error' in err
        ? String((err as { error: string }).error)
        : String(err);
      setCreateError(msg.includes('vec0') ? t.brain.vec0Unavailable : msg);
    } finally { setCreating(false); }
  };

  const handleBind = async (id: string) => {
    if (!activeTwinId) return;
    await bindTwinKnowledgeBase(activeTwinId, id);
    await fetchTwinProfiles();
    setPickMode(false);
    try {
      const kb = await invoke<KbInfo>('get_knowledge_base', { kbId: id });
      setKbInfo(kb);
      lastLoadedKbId.current = id;
    } catch (err) {
      silentCatch('useBrainConnection:handleBind:get_knowledge_base')(err);
    }
  };

  const handleUnbind = async () => {
    if (!activeTwinId) return;
    await unbindTwinKnowledgeBase(activeTwinId);
    await fetchTwinProfiles();
    setKbInfo(null);
    lastLoadedKbId.current = null;
  };

  const obsidianBound = !!activeTwin?.obsidian_subpath?.trim();
  const kbBound = !!kbInfo;
  const kbReady = kbInfo?.status === 'ready';

  return {
    activeTwin, activeTwinId,
    kbInfo, allKbs, kbLoading, createError, creating, pickMode, setPickMode,
    obsidianBound, kbBound, kbReady,
    refreshKb, loadAllKbs, handleCreateKb, handleBind, handleUnbind,
  };
}
