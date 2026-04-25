import { useEffect, useState, useRef } from 'react';
import { Brain, Database, Link, Unlink, FolderTree, RefreshCw, AlertCircle, BookOpen, Cpu, Network, Sparkles } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { Button } from '@/features/shared/components/buttons';
import { invokeWithTimeout as invoke } from '@/lib/tauriInvoke';
import { TwinEmptyState } from '../TwinEmptyState';
import { useTwinTranslation } from '../i18n/useTwinTranslation';

/* ------------------------------------------------------------------ *
 *  Atelier — "Cortex"
 *  Two memory layers visualised as concentric panels with a stylised
 *  brain SVG. Steps presented as a numbered story trail.
 * ------------------------------------------------------------------ */

interface KbInfo { id: string; name: string; document_count: number; chunk_count: number; status: string; }

export default function BrainAtelier() {
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
      {/* ── Header band — brain illustration + KPI ───────────────── */}
      <div className="flex-shrink-0 relative overflow-hidden border-b border-primary/10">
        <div className="absolute inset-0 bg-gradient-to-r from-violet-500/15 via-fuchsia-500/8 to-cyan-500/8" />
        <BrainHaloSvg />
        <div className="relative px-4 md:px-6 xl:px-8 py-5 flex items-center gap-4">
          <div className="relative w-12 h-12 rounded-full bg-violet-500/15 border border-violet-400/40 flex items-center justify-center">
            <Brain className="w-5 h-5 text-violet-300" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] uppercase tracking-[0.22em] text-violet-300/80 font-medium">Cortex</p>
            <h1 className="typo-heading-lg text-foreground/95">{t.brain.title} — {activeTwin?.name ?? ''}</h1>
            <p className="typo-caption text-foreground/65 mt-0.5">{t.brain.subtitle}</p>
          </div>
          <div className="hidden md:flex items-center gap-3 px-3 py-2 rounded-full border border-primary/15 bg-card/40">
            <Stat label="docs" value={kbInfo?.document_count ?? '—'} accent={kbBound ? 'violet' : 'amber'} />
            <span className="w-px h-6 bg-primary/15" />
            <Stat label="chunks" value={kbInfo?.chunk_count ?? '—'} />
            <span className="w-px h-6 bg-primary/15" />
            <Stat label="status" value={kbInfo?.status ?? 'unbound'} accent={kbReady ? 'emerald' : 'amber'} />
          </div>
        </div>
      </div>

      {/* ── Body ─────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-[1400px] mx-auto px-4 md:px-6 xl:px-8 py-6 grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-6">

          <div className="space-y-5 min-w-0">
            {/* ── Layer 1: Obsidian Vault ─────────────────────────── */}
            <Layer
              index="01"
              title={t.brain.obsidianVault}
              tag={t.brain.optional}
              tagTone="muted"
              icon={BookOpen}
              accentFrom="from-violet-500/15"
              accentTo="to-fuchsia-500/8"
              borderColor="border-violet-500/25"
              status={obsidianBound ? 'connected' : 'unbound'}
              statusTone={obsidianBound ? 'emerald' : 'muted'}
            >
              <p className="typo-body text-foreground/85 leading-relaxed">
                {t.brain.obsidianDescription}
              </p>
              <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-interactive border border-primary/10 bg-card/60 font-mono text-xs">
                <FolderTree className="w-3.5 h-3.5 text-violet-300 flex-shrink-0" />
                <span className="text-foreground truncate">{activeTwin?.obsidian_subpath || <span className="italic text-foreground/40">no subpath set</span>}</span>
                <span className="ml-auto text-[10px] text-foreground/55 uppercase tracking-wider">{t.brain.obsidianTwinReadsFrom.replace(/[:.]/g, '').trim()}</span>
              </div>
              <p className="typo-caption text-foreground/65 mt-3">{t.brain.obsidianHint}</p>
            </Layer>

            {/* ── Layer 2: Knowledge Base ─────────────────────────── */}
            <Layer
              index="02"
              title={t.brain.knowledgeBase}
              tag={t.brain.requiredForRecall}
              tagTone="violet"
              icon={Network}
              accentFrom="from-cyan-500/15"
              accentTo="to-violet-500/8"
              borderColor="border-cyan-500/25"
              status={kbReady ? 'ready' : kbBound ? 'indexing' : 'unbound'}
              statusTone={kbReady ? 'emerald' : kbBound ? 'amber' : 'muted'}
            >
              <p className="typo-body text-foreground/85 leading-relaxed">{t.brain.kbDescription}</p>

              {kbLoading ? (
                <div className="flex items-center gap-3 mt-4">
                  <div className="w-5 h-5 border-2 border-violet-400/30 border-t-violet-400 rounded-full animate-spin" />
                  <span className="typo-caption text-foreground/65">{t.brain.loadingKb}</span>
                </div>
              ) : kbInfo ? (
                <>
                  <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <KpiPanel label="documents" value={kbInfo.document_count} icon={BookOpen} />
                    <KpiPanel label="chunks" value={kbInfo.chunk_count} icon={Cpu} />
                    <KpiPanel label="status" value={kbInfo.status} icon={Sparkles} accent={kbReady ? 'emerald' : 'amber'} />
                    <KpiPanel label="bound to" value={kbInfo.name} icon={Link} mono />
                  </div>
                  <div className="flex items-center gap-2 mt-4 pt-4 border-t border-primary/5">
                    <Button onClick={refreshKb} variant="ghost" size="sm"><RefreshCw className="w-3.5 h-3.5 mr-1.5" />{t.brain.refresh}</Button>
                    <Button onClick={handleUnbind} variant="ghost" size="sm"><Unlink className="w-3.5 h-3.5 mr-1.5" />{t.brain.unbind}</Button>
                  </div>
                </>
              ) : (
                <div className="mt-4 space-y-3">
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
                    <div className="p-3 rounded-card border border-primary/15 bg-background space-y-1.5">
                      <p className="typo-caption text-foreground/85 font-medium mb-1">{t.brain.selectExistingKb}</p>
                      {allKbs.length === 0 ? (
                        <p className="typo-caption text-foreground/55">{t.brain.noKbsFound}</p>
                      ) : allKbs.map((kb) => (
                        <button key={kb.id} onClick={() => handleBind(kb.id)} className="w-full flex items-center justify-between px-3 py-2 rounded-interactive hover:bg-violet-500/10 transition-colors text-left group">
                          <div className="flex items-center gap-2">
                            <Database className="w-3.5 h-3.5 text-violet-300" />
                            <span className="typo-body text-foreground group-hover:text-violet-200">{kb.name}</span>
                          </div>
                          <span className="typo-caption text-foreground/55">{kb.document_count} {t.brain.docs}</span>
                        </button>
                      ))}
                      <button onClick={() => setPickMode(false)} className="typo-caption text-foreground/55 hover:text-foreground mt-1 px-2">{t.profiles.cancel}</button>
                    </div>
                  )}
                </div>
              )}
            </Layer>
          </div>

          {/* RIGHT — Story trail */}
          <aside className="hidden xl:block">
            <div className="sticky top-4 rounded-card border border-primary/10 bg-card/40 p-4">
              <div className="flex items-center gap-2 mb-4">
                <Sparkles className="w-4 h-4 text-violet-300" />
                <p className="text-[10px] uppercase tracking-[0.2em] text-foreground/55 font-medium">{t.brain.howBrainGrows}</p>
              </div>
              <ol className="space-y-3">
                {[t.brain.brainStep1, t.brain.brainStep2, t.brain.brainStep3, t.brain.brainStep4, t.brain.brainStep5].map((step, i) => (
                  <li key={i} className="flex gap-3">
                    <div className="flex flex-col items-center flex-shrink-0">
                      <div className="w-6 h-6 rounded-full bg-violet-500/15 border border-violet-400/40 flex items-center justify-center font-mono text-[10px] text-violet-300">
                        {i + 1}
                      </div>
                      {i < 4 && <div className="w-px flex-1 bg-violet-500/15 mt-1.5" />}
                    </div>
                    <p className="typo-caption text-foreground/85 leading-relaxed pb-3">{step}</p>
                  </li>
                ))}
              </ol>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

/* ── Sub-components ────────────────────────────────────────────── */

function BrainHaloSvg() {
  return (
    <svg className="absolute inset-0 w-full h-full opacity-25 pointer-events-none" viewBox="0 0 600 200" preserveAspectRatio="xMaxYMid slice">
      <defs>
        <linearGradient id="brain-stroke" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#a78bfa" stopOpacity="0.6" />
          <stop offset="50%" stopColor="#22d3ee" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#f472b6" stopOpacity="0.5" />
        </linearGradient>
      </defs>
      <g transform="translate(440 100)" stroke="url(#brain-stroke)" fill="none" strokeWidth="0.7">
        <circle r="80" />
        <circle r="60" />
        <circle r="40" />
        <circle r="20" />
        <line x1="-80" y1="0" x2="80" y2="0" />
        <line x1="0" y1="-80" x2="0" y2="80" />
        <line x1="-56" y1="-56" x2="56" y2="56" />
        <line x1="-56" y1="56" x2="56" y2="-56" />
      </g>
      <g fill="#a78bfa">
        {[...Array(20)].map((_, i) => {
          const a = (i / 20) * 2 * Math.PI;
          const x = 440 + Math.cos(a) * 80;
          const y = 100 + Math.sin(a) * 80;
          return <circle key={i} cx={x} cy={y} r={1.5} opacity={0.6} />;
        })}
      </g>
    </svg>
  );
}

interface LayerProps {
  index: string;
  title: string;
  tag: string;
  tagTone: 'muted' | 'violet' | 'emerald';
  icon: typeof Brain;
  accentFrom: string;
  accentTo: string;
  borderColor: string;
  status: string;
  statusTone: 'muted' | 'emerald' | 'amber';
  children: React.ReactNode;
}
function Layer({ index, title, tag, tagTone, icon: Icon, accentFrom, accentTo, borderColor, status, statusTone, children }: LayerProps) {
  const tagClass = tagTone === 'violet' ? 'bg-violet-500/15 text-violet-300 border-violet-500/25'
    : tagTone === 'emerald' ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25'
    : 'bg-secondary/40 text-foreground/65 border-primary/10';
  const statusClass = statusTone === 'emerald' ? 'text-emerald-300'
    : statusTone === 'amber' ? 'text-amber-300'
    : 'text-foreground/55';
  return (
    <section className={`relative rounded-card border ${borderColor} bg-gradient-to-br ${accentFrom} ${accentTo} p-5 md:p-6 shadow-elevation-1 overflow-hidden`}>
      <div className="absolute -top-12 -right-12 w-40 h-40 rounded-full bg-gradient-to-br from-violet-500/15 to-transparent blur-3xl pointer-events-none" />
      <div className="relative flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-card bg-card/60 border border-primary/15 flex items-center justify-center">
          <Icon className="w-5 h-5 text-violet-300" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] text-violet-300 tracking-wider">{index}</span>
            <h2 className="typo-section-title">{title}</h2>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className={`px-2 py-0.5 text-[10px] font-medium rounded-full border ${tagClass}`}>{tag}</span>
            <span className={`text-[10px] uppercase tracking-[0.18em] font-medium ${statusClass}`}>· {status}</span>
          </div>
        </div>
      </div>
      <div className="relative">{children}</div>
    </section>
  );
}

function KpiPanel({ label, value, icon: Icon, accent = 'violet', mono }: { label: string; value: number | string; icon: typeof Brain; accent?: 'violet' | 'emerald' | 'amber'; mono?: boolean }) {
  const tone = accent === 'emerald' ? 'text-emerald-300' : accent === 'amber' ? 'text-amber-300' : 'text-violet-300';
  return (
    <div className="rounded-interactive border border-primary/10 bg-card/60 px-3 py-2.5">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className={`w-3 h-3 ${tone}`} />
        <span className="text-[9px] uppercase tracking-[0.18em] text-foreground/55">{label}</span>
      </div>
      <p className={`${mono ? 'font-mono text-xs' : 'typo-data-lg'} ${tone} truncate`}>{value}</p>
    </div>
  );
}

function Stat({ label, value, accent = 'violet' }: { label: string; value: number | string; accent?: 'violet' | 'emerald' | 'amber' }) {
  const tone = accent === 'emerald' ? 'text-emerald-300' : accent === 'amber' ? 'text-amber-300' : 'text-violet-300';
  return (
    <div className="flex flex-col items-start leading-tight">
      <span className={`typo-data-lg tabular-nums ${tone}`}>{value}</span>
      <span className="text-[9px] uppercase tracking-[0.18em] text-foreground/55">{label}</span>
    </div>
  );
}

