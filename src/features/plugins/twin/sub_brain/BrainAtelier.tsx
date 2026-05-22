import { Brain, Database, Link, Unlink, FolderTree, RefreshCw, AlertCircle, BookOpen, Cpu, Network, Sparkles } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { TwinEmptyState } from '../TwinEmptyState';
import { useTranslation } from '@/i18n/useTranslation';
import { useBrainConnection } from './useBrainConnection';
import { TwinHeaderBand } from '../_shared/TwinHeaderBand';
import { BrainDecoration } from '../_shared/decorations';
import { RejectionPatternsPanel } from './RejectionPatternsPanel';

/* ------------------------------------------------------------------ *
 *  Atelier — "Cortex"
 *  Two memory layers visualised as concentric panels with a stylised
 *  brain SVG. Steps presented as a numbered story trail.
 * ------------------------------------------------------------------ */

export default function BrainAtelier() {
  const t = useTranslation().t.twin;
  const {
    activeTwin, activeTwinId,
    kbInfo, allKbs, kbLoading, createError, creating, pickMode, setPickMode,
    obsidianBound, kbBound, kbReady,
    refreshKb, loadAllKbs, handleCreateKb, handleBind, handleUnbind,
  } = useBrainConnection();

  if (!activeTwinId) return <TwinEmptyState icon={Brain} title={t.brain.title} />;

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      <TwinHeaderBand
        accent="violet"
        icon={<Brain className="w-5 h-5 text-violet-300" />}
        eyebrow={t.brain.eyebrowAtelier}
        title={`${t.brain.title} — ${activeTwin?.name ?? ''}`}
        subtitle={t.brain.subtitle}
        decoration={<BrainDecoration />}
        kpis={
          <>
            <Stat label={t.brain.documents} value={kbInfo?.document_count ?? '—'} accent={kbBound ? 'violet' : 'amber'} />
            <span className="w-px h-6 bg-primary/15" />
            <Stat label={t.brain.chunks} value={kbInfo?.chunk_count ?? '—'} />
            <span className="w-px h-6 bg-primary/15" />
            <Stat label={t.brain.statusLabel} value={kbInfo?.status ?? 'unbound'} accent={kbReady ? 'emerald' : 'amber'} />
          </>
        }
      />

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
                <span className="text-foreground truncate">{activeTwin?.obsidian_subpath || <span className="italic text-foreground">{t.brain.noSubpathSet}</span>}</span>
                <span className="ml-auto text-[10px] text-foreground uppercase tracking-wider">{t.brain.obsidianTagShort}</span>
              </div>
              <p className="typo-caption text-foreground mt-3">{t.brain.obsidianHint}</p>
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
                  <span className="typo-caption text-foreground">{t.brain.loadingKb}</span>
                </div>
              ) : kbInfo ? (
                <>
                  <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <KpiPanel label={t.brain.documents} value={kbInfo.document_count} icon={BookOpen} />
                    <KpiPanel label={t.brain.chunks} value={kbInfo.chunk_count} icon={Cpu} />
                    <KpiPanel label={t.brain.statusLabel} value={kbInfo.status} icon={Sparkles} accent={kbReady ? 'emerald' : 'amber'} />
                    <KpiPanel label={t.brain.boundToLabel} value={kbInfo.name} icon={Link} mono />
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
                        <p className="typo-caption text-foreground">{t.brain.noKbsFound}</p>
                      ) : allKbs.map((kb) => (
                        <button key={kb.id} onClick={() => handleBind(kb.id)} className="w-full flex items-center justify-between px-3 py-2 rounded-interactive hover:bg-violet-500/10 transition-colors text-left group">
                          <div className="flex items-center gap-2">
                            <Database className="w-3.5 h-3.5 text-violet-300" />
                            <span className="typo-body text-foreground group-hover:text-violet-200">{kb.name}</span>
                          </div>
                          <span className="typo-caption text-foreground">{kb.document_count} {t.brain.docs}</span>
                        </button>
                      ))}
                      <button onClick={() => setPickMode(false)} className="typo-caption text-foreground hover:text-foreground mt-1 px-2">{t.profiles.cancel}</button>
                    </div>
                  )}
                </div>
              )}
            </Layer>

            {/* Rejection patterns — aggregate over the reviewer_notes column
                that the knowledge inbox started populating in cycle 3. */}
            <RejectionPatternsPanel twinId={activeTwinId} />
          </div>

          {/* RIGHT — Story trail */}
          <aside className="hidden xl:block">
            <div className="sticky top-4 rounded-card border border-primary/10 bg-card/40 p-4">
              <div className="flex items-center gap-2 mb-4">
                <Sparkles className="w-4 h-4 text-violet-300" />
                <p className="text-[10px] uppercase tracking-[0.2em] text-foreground font-medium">{t.brain.howBrainGrows}</p>
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
    : 'bg-secondary/40 text-foreground border-primary/10';
  const statusClass = statusTone === 'emerald' ? 'text-emerald-300'
    : statusTone === 'amber' ? 'text-amber-300'
    : 'text-foreground';
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
        <span className="text-[9px] uppercase tracking-[0.18em] text-foreground">{label}</span>
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
      <span className="text-[9px] uppercase tracking-[0.18em] text-foreground">{label}</span>
    </div>
  );
}

