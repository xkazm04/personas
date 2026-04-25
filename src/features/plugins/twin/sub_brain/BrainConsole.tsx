import { useEffect, useState, useRef } from 'react';
import { Brain, Database, Link, Unlink, FolderTree, RefreshCw, AlertCircle, Terminal, BookOpen, Cpu, CheckCircle2 } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { Button } from '@/features/shared/components/buttons';
import { invokeWithTimeout as invoke } from '@/lib/tauriInvoke';
import { TwinEmptyState } from '../TwinEmptyState';
import { useTwinTranslation } from '../i18n/useTwinTranslation';

/* ------------------------------------------------------------------ *
 *  Console — "Memory Console"
 *  Top KPI strip + two terminal-style panels for Obsidian and KB.
 *  Step list rendered as a checklist.
 * ------------------------------------------------------------------ */

interface KbInfo { id: string; name: string; document_count: number; chunk_count: number; status: string; }

export default function BrainConsole() {
  const { t } = useTwinTranslation();
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
    invoke<KbInfo>("get_knowledge_base", { kbId }).then((kb) => setKbInfo(kb)).catch(() => setKbInfo(null)).finally(() => setKbLoading(false));
  }, [kbId]);

  const refreshKb = () => {
    if (!kbId) return;
    lastLoadedKbId.current = null;
    setKbLoading(true);
    invoke<KbInfo>("get_knowledge_base", { kbId }).then((kb) => { setKbInfo(kb); lastLoadedKbId.current = kbId; }).catch(() => setKbInfo(null)).finally(() => setKbLoading(false));
  };
  const loadAllKbs = async () => { try { setAllKbs(await invoke<KbInfo[]>("list_knowledge_bases")); } catch { setAllKbs([]); } };
  const handleCreateKb = async () => {
    if (!activeTwinId || !activeTwin) return;
    setCreating(true); setCreateError(null);
    try {
      const kb = await invoke<KbInfo>("create_knowledge_base", { name: `${activeTwin.name} Brain`, description: `Knowledge base for twin: ${activeTwin.name}` });
      await bindTwinKnowledgeBase(activeTwinId, kb.id); await fetchTwinProfiles();
      setKbInfo(kb); lastLoadedKbId.current = kb.id;
    } catch (err) {
      const msg = typeof err === 'object' && err !== null && 'error' in err ? String((err as { error: string }).error) : String(err);
      setCreateError(msg.includes('vec0') ? 'Vector extension (vec0) not available. Use "Link Existing" to connect a knowledge base created from the Credentials page.' : msg);
    } finally { setCreating(false); }
  };
  const handleBind = async (id: string) => {
    if (!activeTwinId) return;
    await bindTwinKnowledgeBase(activeTwinId, id); await fetchTwinProfiles(); setPickMode(false);
    try { const kb = await invoke<KbInfo>("get_knowledge_base", { kbId: id }); setKbInfo(kb); lastLoadedKbId.current = id; } catch { /* next render */ }
  };
  const handleUnbind = async () => {
    if (!activeTwinId) return;
    await unbindTwinKnowledgeBase(activeTwinId); await fetchTwinProfiles();
    setKbInfo(null); lastLoadedKbId.current = null;
  };

  if (!activeTwinId) return <TwinEmptyState icon={Brain} title={t.brain.title} />;

  const obsidianBound = !!activeTwin?.obsidian_subpath?.trim();
  const kbBound = !!kbInfo;
  const kbReady = kbInfo?.status === 'ready';

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      {/* ── Strip header ─────────────────────────────────────────── */}
      <div className="flex-shrink-0 flex items-center gap-3 px-4 md:px-6 xl:px-8 py-3 border-b border-primary/10 bg-card/40">
        <div className="w-8 h-8 rounded-interactive bg-violet-500/15 border border-violet-500/30 flex items-center justify-center">
          <Terminal className="w-4 h-4 text-violet-300" />
        </div>
        <div className="flex flex-col leading-tight min-w-0">
          <h1 className="typo-card-label">brain / {activeTwin?.name ?? '?'}</h1>
          <span className="typo-caption text-foreground/55 truncate">{t.brain.subtitle}</span>
        </div>
        <div className="flex-1" />
        <div className="flex items-stretch gap-2">
          <Tile label="documents" value={kbInfo?.document_count ?? '—'} accent={kbBound ? 'violet' : 'amber'} />
          <Tile label="chunks" value={kbInfo?.chunk_count ?? '—'} />
          <Tile label="status" value={kbInfo?.status ?? 'unbound'} accent={kbReady ? 'emerald' : kbBound ? 'amber' : 'amber'} />
          <Tile label="vault" value={obsidianBound ? 'set' : 'none'} accent={obsidianBound ? 'emerald' : 'amber'} />
        </div>
      </div>

      {/* ── Body ─────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-[1300px] mx-auto px-4 md:px-6 xl:px-8 py-5 grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* ── Obsidian panel ───────────────────────────────────── */}
          <ConsolePanel name="obsidian.vault" subtitle={t.brain.optional} icon={BookOpen} stateColor={obsidianBound ? 'emerald' : 'amber'} stateLabel={obsidianBound ? 'connected' : 'unbound'}>
            <p className="typo-body text-foreground/85 leading-relaxed">{t.brain.obsidianDescription}</p>
            <div className="mt-3 rounded-interactive border border-primary/10 bg-card/60 p-3">
              <p className="text-[10px] uppercase tracking-[0.16em] text-foreground/55 font-medium mb-1">read path</p>
              <div className="flex items-center gap-2">
                <FolderTree className="w-3.5 h-3.5 text-violet-300" />
                <code className="typo-code text-xs text-foreground truncate">{activeTwin?.obsidian_subpath || '—'}</code>
              </div>
            </div>
            <p className="typo-caption text-foreground/65 mt-3">{t.brain.obsidianHint}</p>
          </ConsolePanel>

          {/* ── KB panel ──────────────────────────────────────────── */}
          <ConsolePanel name="knowledge.base" subtitle={t.brain.requiredForRecall} icon={Database} stateColor={kbReady ? 'emerald' : kbBound ? 'amber' : 'amber'} stateLabel={kbInfo?.status ?? 'unbound'}>
            <p className="typo-body text-foreground/85 leading-relaxed">{t.brain.kbDescription}</p>

            {kbLoading ? (
              <div className="flex items-center gap-3 mt-4">
                <div className="w-5 h-5 border-2 border-violet-400/30 border-t-violet-400 rounded-full animate-spin" />
                <span className="typo-caption text-foreground/65">{t.brain.loadingKb}</span>
              </div>
            ) : kbInfo ? (
              <>
                <div className="grid grid-cols-2 gap-2 mt-3">
                  <Stat label="name" value={kbInfo.name} mono />
                  <Stat label="documents" value={kbInfo.document_count} icon={BookOpen} />
                  <Stat label="chunks" value={kbInfo.chunk_count} icon={Cpu} />
                  <Stat label="status" value={kbInfo.status} accent={kbReady ? 'emerald' : 'amber'} />
                </div>
                <div className="flex items-center gap-2 mt-4 pt-3 border-t border-primary/5">
                  <Button onClick={refreshKb} variant="ghost" size="sm"><RefreshCw className="w-3.5 h-3.5 mr-1.5" />{t.brain.refresh}</Button>
                  <Button onClick={handleUnbind} variant="ghost" size="sm"><Unlink className="w-3.5 h-3.5 mr-1.5" />{t.brain.unbind}</Button>
                </div>
              </>
            ) : (
              <div className="mt-3 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Button onClick={handleCreateKb} disabled={creating} size="sm" variant="accent" accentColor="violet">
                    <Database className="w-3.5 h-3.5 mr-1.5" />{creating ? t.brain.creatingKb : t.brain.createNewKb}
                  </Button>
                  <Button onClick={() => { setPickMode(true); loadAllKbs(); }} variant="secondary" size="sm">
                    <Link className="w-3.5 h-3.5 mr-1.5" />{t.brain.linkExisting}
                  </Button>
                </div>
                {createError && (
                  <div className="flex items-start gap-2 p-3 rounded-card border border-amber-500/20 bg-amber-500/5">
                    <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                    <p className="typo-caption text-foreground/85">{createError}</p>
                  </div>
                )}
                {pickMode && (
                  <div className="rounded-card border border-primary/10 bg-background overflow-hidden">
                    <div className="px-3 py-1.5 border-b border-primary/10 bg-card/60 text-[10px] uppercase tracking-[0.16em] text-foreground/55 font-medium">{t.brain.selectExistingKb}</div>
                    <div className="divide-y divide-primary/5">
                      {allKbs.length === 0 ? (
                        <p className="px-3 py-4 typo-caption text-foreground/55">{t.brain.noKbsFound}</p>
                      ) : allKbs.map((kb) => (
                        <button key={kb.id} onClick={() => handleBind(kb.id)} className="w-full flex items-center justify-between px-3 py-2 hover:bg-violet-500/10 transition-colors text-left">
                          <div className="flex items-center gap-2">
                            <Database className="w-3.5 h-3.5 text-violet-300" />
                            <span className="typo-body text-foreground">{kb.name}</span>
                          </div>
                          <span className="typo-caption text-foreground/55">{kb.document_count} {t.brain.docs}</span>
                        </button>
                      ))}
                    </div>
                    <button onClick={() => setPickMode(false)} className="w-full px-3 py-2 typo-caption text-foreground/55 hover:text-foreground hover:bg-secondary/30 border-t border-primary/5 text-left">{t.profiles.cancel}</button>
                  </div>
                )}
              </div>
            )}
          </ConsolePanel>

          {/* ── Steps checklist (full-width) ─────────────────────── */}
          <section className="lg:col-span-2 rounded-card border border-primary/10 bg-card/40 p-4 md:p-5">
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle2 className="w-4 h-4 text-violet-300" />
              <p className="text-[10px] uppercase tracking-[0.2em] text-foreground/55 font-medium">{t.brain.howBrainGrows}</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
              {[t.brain.brainStep1, t.brain.brainStep2, t.brain.brainStep3, t.brain.brainStep4, t.brain.brainStep5].map((step, i) => (
                <div key={i} className="flex gap-2 items-start p-3 rounded-interactive border border-primary/5 bg-background/60">
                  <span className="font-mono text-[10px] text-violet-300 mt-0.5">0{i + 1}</span>
                  <p className="typo-caption text-foreground/85 leading-relaxed">{step}</p>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

/* ── Sub-components ───────────────────────────────────────────────── */

function ConsolePanel({ name, subtitle, icon: Icon, stateColor, stateLabel, children }: { name: string; subtitle: string; icon: typeof Brain; stateColor: 'emerald' | 'amber' | 'violet'; stateLabel: string; children: React.ReactNode }) {
  const tone = stateColor === 'emerald' ? 'text-emerald-300 border-emerald-500/25 bg-emerald-500/10' : stateColor === 'amber' ? 'text-amber-300 border-amber-500/25 bg-amber-500/10' : 'text-violet-300 border-violet-500/25 bg-violet-500/10';
  return (
    <section className="rounded-card border border-primary/10 bg-card/40 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-primary/10 bg-card/60">
        <Icon className="w-4 h-4 text-violet-300" />
        <span className="font-mono text-xs text-foreground">{name}</span>
        <span className="typo-caption text-foreground/55">— {subtitle}</span>
        <span className={`ml-auto px-2 py-0.5 text-[10px] uppercase tracking-wider font-medium rounded-full border ${tone}`}>{stateLabel}</span>
      </div>
      <div className="p-4 md:p-5">{children}</div>
    </section>
  );
}

function Tile({ label, value, accent = 'violet' }: { label: string; value: number | string; accent?: 'violet' | 'emerald' | 'amber' }) {
  const tone = accent === 'emerald' ? 'text-emerald-300 border-emerald-500/25' : accent === 'amber' ? 'text-amber-300 border-amber-500/25' : 'text-violet-300 border-violet-500/25';
  return (
    <div className={`rounded-interactive border ${tone} bg-card/40 px-2.5 py-1 flex flex-col items-center min-w-[72px]`}>
      <span className="typo-data-lg tabular-nums leading-none">{value}</span>
      <span className="text-[9px] uppercase tracking-[0.16em] text-foreground/55 mt-0.5">{label}</span>
    </div>
  );
}

function Stat({ label, value, icon: Icon, accent = 'violet', mono }: { label: string; value: number | string; icon?: typeof Brain; accent?: 'violet' | 'emerald' | 'amber'; mono?: boolean }) {
  const tone = accent === 'emerald' ? 'text-emerald-300' : accent === 'amber' ? 'text-amber-300' : 'text-violet-300';
  return (
    <div className="rounded-interactive border border-primary/10 bg-background/60 px-3 py-2">
      <div className="flex items-center gap-1.5 mb-0.5">
        {Icon && <Icon className={`w-3 h-3 ${tone}`} />}
        <span className="text-[9px] uppercase tracking-[0.18em] text-foreground/55">{label}</span>
      </div>
      <p className={`${mono ? 'font-mono text-xs' : 'typo-data-lg'} ${tone} truncate`}>{value}</p>
    </div>
  );
}
