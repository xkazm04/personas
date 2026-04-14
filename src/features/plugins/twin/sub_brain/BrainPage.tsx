import { useEffect, useState, useRef } from 'react';
import { Brain, Database, Link, Unlink, FolderTree, RefreshCw, AlertCircle } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { Button } from '@/features/shared/components/buttons';
import { invokeWithTimeout as invoke } from '@/lib/tauriInvoke';
import { TwinEmptyState } from '../TwinEmptyState';

/**
 * Brain tab — the twin's memory system.
 *
 * Two independent layers:
 * 1. **Obsidian Vault** (optional) — human-readable notes.
 * 2. **Knowledge Base** (required for recall) — vector-indexed store.
 */

interface KbInfo {
  id: string;
  name: string;
  document_count: number;
  chunk_count: number;
  status: string;
}

export default function BrainPage() {
  const twinProfiles = useSystemStore((s) => s.twinProfiles);
  const activeTwinId = useSystemStore((s) => s.activeTwinId);
  const bindTwinKnowledgeBase = useSystemStore((s) => s.bindTwinKnowledgeBase);
  const unbindTwinKnowledgeBase = useSystemStore((s) => s.unbindTwinKnowledgeBase);
  const fetchTwinProfiles = useSystemStore((s) => s.fetchTwinProfiles);

  const activeTwin = twinProfiles.find((t) => t.id === activeTwinId);
  const kbId = activeTwin?.knowledge_base_id ?? null;

  const [kbInfo, setKbInfo] = useState<KbInfo | null>(null);
  const [allKbs, setAllKbs] = useState<KbInfo[]>([]);
  const [kbLoading, setKbLoading] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [pickMode, setPickMode] = useState(false);

  // Track the last loaded KB ID to prevent re-fetch loops
  const lastLoadedKbId = useRef<string | null>(null);

  useEffect(() => {
    if (!kbId) { setKbInfo(null); lastLoadedKbId.current = null; return; }
    if (kbId === lastLoadedKbId.current) return; // already loaded
    lastLoadedKbId.current = kbId;
    setKbLoading(true);
    invoke<KbInfo>("get_knowledge_base", { kbId })
      .then((kb) => setKbInfo(kb))
      .catch(() => setKbInfo(null))
      .finally(() => setKbLoading(false));
  }, [kbId]);

  const refreshKb = () => {
    if (!kbId) return;
    lastLoadedKbId.current = null; // force reload
    setKbLoading(true);
    invoke<KbInfo>("get_knowledge_base", { kbId })
      .then((kb) => { setKbInfo(kb); lastLoadedKbId.current = kbId; })
      .catch(() => setKbInfo(null))
      .finally(() => setKbLoading(false));
  };

  const loadAllKbs = async () => {
    try { setAllKbs(await invoke<KbInfo[]>("list_knowledge_bases")); }
    catch { setAllKbs([]); }
  };

  const handleCreateKb = async () => {
    if (!activeTwinId || !activeTwin) return;
    setCreating(true);
    setCreateError(null);
    try {
      const kb = await invoke<KbInfo>("create_knowledge_base", {
        name: `${activeTwin.name} Brain`,
        description: `Knowledge base for twin: ${activeTwin.name}`,
      });
      await bindTwinKnowledgeBase(activeTwinId, kb.id);
      await fetchTwinProfiles();
      setKbInfo(kb);
      lastLoadedKbId.current = kb.id;
    } catch (err) {
      const msg = typeof err === 'object' && err !== null && 'error' in err
        ? String((err as { error: string }).error) : String(err);
      setCreateError(msg.includes('vec0')
        ? 'Vector extension (vec0) not available. Use "Link Existing" to connect a knowledge base created from the Credentials page.'
        : msg);
    } finally {
      setCreating(false);
    }
  };

  const handleBind = async (id: string) => {
    if (!activeTwinId) return;
    await bindTwinKnowledgeBase(activeTwinId, id);
    await fetchTwinProfiles();
    setPickMode(false);
    try { const kb = await invoke<KbInfo>("get_knowledge_base", { kbId: id }); setKbInfo(kb); lastLoadedKbId.current = id; }
    catch { /* next render */ }
  };

  const handleUnbind = async () => {
    if (!activeTwinId) return;
    await unbindTwinKnowledgeBase(activeTwinId);
    await fetchTwinProfiles();
    setKbInfo(null);
    lastLoadedKbId.current = null;
  };

  if (!activeTwinId) return <TwinEmptyState icon={Brain} title="Brain" />;

  return (
    <ContentBox>
      <ContentHeader
        icon={<Brain className="w-5 h-5 text-violet-400" />}
        iconColor="violet"
        title={`Brain — ${activeTwin?.name ?? 'Twin'}`}
        subtitle="The twin's memory has two layers: an Obsidian vault for human-readable notes and a knowledge base for semantic recall."
      />

      <ContentBody>
        <div className="space-y-6 pb-8">

          {/* ── Layer 1: Obsidian Vault ───────────────────────────────── */}
          <div className="p-4 rounded-card border border-violet-500/15 bg-violet-500/5">
            <div className="flex items-center gap-2 mb-2">
              <FolderTree className="w-4 h-4 text-violet-400" />
              <span className="typo-heading text-foreground">Obsidian Vault</span>
              <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-secondary/30 text-muted-foreground">Optional</span>
            </div>
            <p className="typo-body text-foreground mb-2">
              Human-readable notes you can browse and edit directly in Obsidian.
              The twin reads from <code className="typo-code">{activeTwin?.obsidian_subpath}</code>.
            </p>
            <p className="typo-caption text-muted-foreground">
              Connect your vault in the Obsidian Brain plugin. The subfolder path is set in the Identity tab.
              Not required — the twin works with just a knowledge base.
            </p>
          </div>

          {/* ── Layer 2: Knowledge Base ───────────────────────────────── */}
          <div className="p-4 rounded-card border border-primary/10 bg-card/40">
            <div className="flex items-center gap-2 mb-1">
              <Database className="w-4 h-4 text-violet-400" />
              <span className="typo-heading text-foreground">Knowledge Base</span>
              <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-violet-500/15 text-violet-400 border border-violet-500/25">Required for recall</span>
            </div>
            <p className="typo-caption text-muted-foreground mb-3">
              A vector-indexed store that powers semantic search. When a persona calls <code className="typo-code">recall_memory</code>, it searches this KB.
            </p>

            {kbLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="w-6 h-6 border-2 border-violet-400/30 border-t-violet-400 rounded-full animate-spin" />
                <span className="typo-body text-foreground ml-3">Loading knowledge base...</span>
              </div>
            ) : kbInfo ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="typo-body text-foreground font-medium">{kbInfo.name}</p>
                    <p className="typo-caption text-foreground mt-0.5">{kbInfo.document_count} documents, {kbInfo.chunk_count} chunks</p>
                  </div>
                  <span className={`px-2 py-0.5 text-[10px] font-medium rounded-full border ${
                    kbInfo.status === 'ready'
                      ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25'
                      : 'bg-amber-500/15 text-amber-400 border-amber-500/25'
                  }`}>{kbInfo.status}</span>
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <Button onClick={refreshKb} variant="ghost" size="sm"><RefreshCw className="w-3.5 h-3.5 mr-1.5" />Refresh</Button>
                  <Button onClick={handleUnbind} variant="ghost" size="sm"><Unlink className="w-3.5 h-3.5 mr-1.5" />Unbind</Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Button onClick={handleCreateKb} disabled={creating} size="sm">
                    <Database className="w-3.5 h-3.5 mr-1.5" />{creating ? 'Creating...' : 'Create New KB'}
                  </Button>
                  <Button onClick={() => { setPickMode(true); loadAllKbs(); }} variant="secondary" size="sm">
                    <Link className="w-3.5 h-3.5 mr-1.5" />Link Existing
                  </Button>
                </div>
                {createError && (
                  <div className="flex items-start gap-2 p-3 rounded-card border border-amber-500/20 bg-amber-500/5">
                    <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                    <p className="typo-caption text-foreground">{createError}</p>
                  </div>
                )}
                {pickMode && (
                  <div className="p-3 rounded-interactive border border-primary/15 bg-background space-y-2">
                    <p className="typo-caption text-foreground font-medium">Select an existing knowledge base:</p>
                    {allKbs.length === 0 ? (
                      <p className="typo-caption text-muted-foreground">No knowledge bases found. Create one from Credentials or use the button above.</p>
                    ) : allKbs.map((kb) => (
                      <button key={kb.id} onClick={() => handleBind(kb.id)} className="w-full flex items-center justify-between px-3 py-2 rounded-interactive hover:bg-secondary/40 transition-colors text-left">
                        <span className="typo-body text-foreground">{kb.name}</span>
                        <span className="typo-caption text-muted-foreground">{kb.document_count} docs</span>
                      </button>
                    ))}
                    <button onClick={() => setPickMode(false)} className="typo-caption text-muted-foreground hover:text-foreground mt-1">Cancel</button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── How the brain grows ──────────────────────────────────── */}
          <div className="p-4 rounded-card border border-primary/5 bg-card/20">
            <p className="typo-caption text-foreground font-medium mb-2">How the brain grows over time</p>
            <ol className="typo-caption text-foreground space-y-1 list-decimal list-inside">
              <li>Personas call <code className="typo-code">record_interaction</code> after each conversation</li>
              <li>A pending memory is created for your review in the Knowledge tab</li>
              <li>Approved memories get indexed into the knowledge base</li>
              <li>Next time, <code className="typo-code">recall_memory</code> finds relevant context via semantic search</li>
              <li>Obsidian notes (if connected) can be manually ingested too</li>
            </ol>
          </div>
        </div>
      </ContentBody>
    </ContentBox>
  );
}
