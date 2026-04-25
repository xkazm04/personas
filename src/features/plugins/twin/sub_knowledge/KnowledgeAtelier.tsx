import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { BookOpen, CheckCircle2, XCircle, Clock, MessageSquare, ArrowDownLeft, ArrowUpRight, Inbox, History, Library, Star, Quote } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { TwinEmptyState } from '../TwinEmptyState';
import { useTwinTranslation } from '../i18n/useTwinTranslation';

/* ------------------------------------------------------------------ *
 *  Atelier — "Archive"
 *  Memory inbox as a vertical timeline with story cards on the left;
 *  conversations as chat-style cards grouped by date on the right.
 * ------------------------------------------------------------------ */

type MemoryFilter = 'pending' | 'approved' | 'rejected';

interface CommGroup {
  date: string;
  items: Array<{
    id: string;
    direction: string;
    channel: string;
    contact_handle: string | null;
    occurred_at: string;
    content: string;
    summary: string | null;
  }>;
}

function groupCommsByDay(items: CommGroup['items']): CommGroup[] {
  const map = new Map<string, CommGroup['items']>();
  items.forEach((c) => {
    const d = new Date(c.occurred_at);
    const key = d.toLocaleDateString();
    const list = map.get(key) ?? [];
    list.push(c);
    map.set(key, list);
  });
  return Array.from(map.entries()).map(([date, items]) => ({ date, items }));
}

export default function KnowledgeAtelier() {
  const { t } = useTwinTranslation();
  const activeTwinId = useSystemStore((s) => s.activeTwinId);
  const activeTwin = useSystemStore((s) => s.twinProfiles).find((tp) => tp.id === activeTwinId);
  const pendingMemories = useSystemStore((s) => s.twinPendingMemories);
  const pendingLoading = useSystemStore((s) => s.twinPendingLoading);
  const communications = useSystemStore((s) => s.twinCommunications);
  const commsLoading = useSystemStore((s) => s.twinCommsLoading);
  const fetchPending = useSystemStore((s) => s.fetchTwinPendingMemories);
  const reviewMemory = useSystemStore((s) => s.reviewTwinMemory);
  const fetchComms = useSystemStore((s) => s.fetchTwinCommunications);

  const [filter, setFilter] = useState<MemoryFilter>('pending');
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  useEffect(() => {
    if (activeTwinId) { fetchPending(activeTwinId, filter); fetchComms(activeTwinId); }
  }, [activeTwinId, filter, fetchPending, fetchComms]);

  const handleReview = async (id: string, approved: boolean) => {
    setReviewingId(id);
    try { await reviewMemory(id, approved); } finally { setReviewingId(null); }
  };

  const stats = useMemo(() => {
    const pending = pendingMemories.filter((m) => m.status === 'pending').length;
    const approved = pendingMemories.filter((m) => m.status === 'approved').length;
    const rejected = pendingMemories.filter((m) => m.status === 'rejected').length;
    return { pending, approved, rejected };
  }, [pendingMemories]);

  const grouped = useMemo(() => groupCommsByDay(communications), [communications]);

  if (!activeTwinId) return <TwinEmptyState icon={BookOpen} title={t.knowledge.title} />;

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      {/* ── Header band ──────────────────────────────────────────── */}
      <div className="flex-shrink-0 relative overflow-hidden border-b border-primary/10">
        <div className="absolute inset-0 bg-gradient-to-r from-amber-500/8 via-violet-500/12 to-cyan-500/8" />
        <div className="absolute inset-0 opacity-25 pointer-events-none">
          <svg className="w-full h-full" viewBox="0 0 800 200" preserveAspectRatio="xMaxYMid slice">
            {/* Stylised library shelves */}
            {[...Array(5)].map((_, row) => (
              <g key={row} transform={`translate(0 ${row * 40})`}>
                <line x1="0" y1="20" x2="800" y2="20" stroke="#a78bfa" strokeWidth="0.5" opacity="0.3" />
                {[...Array(40)].map((_, i) => (
                  <rect key={i} x={i * 20 + (row % 2) * 4} y={5} width={3 + (i % 5)} height={14} fill={i % 3 === 0 ? '#a78bfa' : i % 4 === 0 ? '#22d3ee' : '#fbbf24'} opacity={0.35} />
                ))}
              </g>
            ))}
          </svg>
        </div>
        <div className="relative px-4 md:px-6 xl:px-8 py-5 flex items-center gap-4">
          <div className="w-12 h-12 rounded-card bg-violet-500/15 border border-violet-400/40 flex items-center justify-center">
            <Library className="w-5 h-5 text-violet-300" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] uppercase tracking-[0.22em] text-violet-300/80 font-medium">Archive</p>
            <h1 className="typo-heading-lg text-foreground/95">{t.knowledge.title} — {activeTwin?.name ?? ''}</h1>
            <p className="typo-caption text-foreground/65 mt-0.5">{t.knowledge.subtitle}</p>
          </div>
          <div className="hidden md:flex items-center gap-3 px-3 py-2 rounded-full border border-primary/15 bg-card/40">
            <Stat label="pending" value={stats.pending} accent={stats.pending > 10 ? 'amber' : 'violet'} />
            <span className="w-px h-6 bg-primary/15" />
            <Stat label="approved" value={stats.approved} accent="emerald" />
            <span className="w-px h-6 bg-primary/15" />
            <Stat label="rejected" value={stats.rejected} />
            <span className="w-px h-6 bg-primary/15" />
            <Stat label="conversations" value={communications.length} />
          </div>
        </div>
      </div>

      {/* ── Body ─────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-hidden grid grid-cols-1 lg:grid-cols-2">

        {/* LEFT — Memory timeline */}
        <section className="border-r border-primary/10 flex flex-col min-h-0">
          <div className="px-4 md:px-6 py-4 border-b border-primary/5 flex items-center gap-3">
            <Inbox className="w-4 h-4 text-violet-300" />
            <h2 className="typo-section-title">{t.knowledge.memoryInbox}</h2>
            <span className={`px-2 py-0.5 text-[10px] font-medium rounded-full border ${stats.pending > 0 ? 'bg-amber-500/15 text-amber-300 border-amber-500/25' : 'bg-secondary/40 text-foreground/55 border-primary/10'}`}>
              {stats.pending} pending
            </span>
            <div className="ml-auto flex items-center gap-1 rounded-full border border-primary/10 bg-secondary/30 p-0.5">
              {(['pending', 'approved', 'rejected'] as const).map((f) => {
                const labelMap = { pending: t.knowledge.filterPending, approved: t.knowledge.filterApproved, rejected: t.knowledge.filterRejected } as const;
                return (
                  <button key={f} onClick={() => setFilter(f)} className={`px-2.5 py-0.5 text-[11px] rounded-full transition-colors ${filter === f ? 'bg-violet-500/20 text-violet-200' : 'text-foreground/65 hover:text-foreground'}`}>
                    {labelMap[f]}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4">
            {pendingLoading ? (
              <div className="flex items-center justify-center py-12"><Clock className="w-5 h-5 text-foreground/55 animate-spin" /></div>
            ) : pendingMemories.length === 0 ? (
              <div className="py-12 text-center">
                <Inbox className="w-10 h-10 text-foreground/30 mx-auto mb-3" />
                <p className="typo-body text-foreground/65">{filter === 'pending' ? t.knowledge.inboxEmpty : t.knowledge.noFilteredMemories.replace('{filter}', filter)}</p>
                <p className="typo-caption text-foreground/55 mt-1">{filter === 'pending' ? t.knowledge.newMemoriesHint : t.knowledge.switchToPending}</p>
              </div>
            ) : (
              <ol className="relative space-y-4 max-w-2xl">
                {/* Timeline rail */}
                <div className="absolute left-3 top-2 bottom-2 w-px bg-gradient-to-b from-violet-500/40 via-violet-500/20 to-transparent" />
                {pendingMemories.map((mem, idx) => {
                  const isReviewing = reviewingId === mem.id;
                  const isPending = mem.status === 'pending';
                  return (
                    <motion.li
                      key={mem.id}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: Math.min(idx * 0.03, 0.3) }}
                      className="relative pl-10"
                    >
                      <div className={`absolute left-0.5 top-2 w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                        isPending ? 'bg-amber-500/15 border-amber-500/50' : mem.status === 'approved' ? 'bg-emerald-500/15 border-emerald-500/50' : 'bg-red-500/10 border-red-500/40'
                      }`}>
                        {isPending ? <Clock className="w-2.5 h-2.5 text-amber-300" /> : mem.status === 'approved' ? <CheckCircle2 className="w-3 h-3 text-emerald-300" /> : <XCircle className="w-3 h-3 text-red-300" />}
                      </div>
                      <div className={`rounded-card border bg-card/40 p-3.5 transition-colors ${
                        isPending ? 'border-amber-500/20 hover:border-amber-500/40' : mem.status === 'approved' ? 'border-emerald-500/15' : 'border-red-500/15'
                      }`}>
                        {mem.title && <p className="typo-card-label mb-1">{mem.title}</p>}
                        <p className="typo-body text-foreground/85 leading-relaxed">{mem.content}</p>
                        <div className="flex items-center flex-wrap gap-2 mt-3 pt-3 border-t border-primary/5">
                          {mem.channel && <span className="px-1.5 py-0.5 text-[9px] uppercase tracking-wider rounded-full bg-secondary/40 text-foreground/65">{mem.channel}</span>}
                          {mem.importance > 3 && (
                            <span className="flex items-center gap-1 px-1.5 py-0.5 text-[9px] rounded-full bg-violet-500/15 text-violet-300 border border-violet-500/25">
                              <Star className="w-2.5 h-2.5" /> priority {mem.importance}
                            </span>
                          )}
                          <span className="typo-caption text-foreground/55">{new Date(mem.created_at).toLocaleDateString()}</span>
                          {isPending && (
                            <div className="ml-auto flex items-center gap-1">
                              <button onClick={() => handleReview(mem.id, true)} disabled={isReviewing} className="px-2 py-1 rounded-interactive text-[11px] font-medium text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors flex items-center gap-1">
                                <CheckCircle2 className="w-3 h-3" /> approve
                              </button>
                              <button onClick={() => handleReview(mem.id, false)} disabled={isReviewing} className="px-2 py-1 rounded-interactive text-[11px] font-medium text-red-300 bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 transition-colors flex items-center gap-1">
                                <XCircle className="w-3 h-3" /> reject
                              </button>
                            </div>
                          )}
                          {!isPending && (
                            <span className={`ml-auto px-2 py-0.5 text-[9px] uppercase tracking-wider rounded-full ${mem.status === 'approved' ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/25' : 'bg-red-500/10 text-red-300 border border-red-500/20'}`}>{mem.status}</span>
                          )}
                        </div>
                      </div>
                    </motion.li>
                  );
                })}
              </ol>
            )}
          </div>
        </section>

        {/* RIGHT — Conversations grouped by day */}
        <section className="flex flex-col min-h-0">
          <div className="px-4 md:px-6 py-4 border-b border-primary/5 flex items-center gap-3">
            <History className="w-4 h-4 text-violet-300" />
            <h2 className="typo-section-title">{t.knowledge.conversationHistory}</h2>
            <span className="text-[10px] uppercase tracking-wider text-foreground/55 ml-auto">{communications.length} entries</span>
          </div>
          <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4">
            {commsLoading ? (
              <div className="flex items-center justify-center py-12"><Clock className="w-5 h-5 text-foreground/55 animate-spin" /></div>
            ) : communications.length === 0 ? (
              <div className="py-12 text-center">
                <MessageSquare className="w-10 h-10 text-foreground/30 mx-auto mb-3" />
                <p className="typo-body text-foreground/65">{t.knowledge.noConversationsYet}</p>
                <p className="typo-caption text-foreground/55 mt-1">{t.knowledge.conversationsHint}</p>
              </div>
            ) : (
              <div className="space-y-5 max-w-2xl">
                {grouped.map((g) => (
                  <div key={g.date}>
                    <div className="flex items-center gap-2 mb-2 sticky top-0 bg-background/80 backdrop-blur py-1.5 z-[1]">
                      <div className="h-px flex-1 bg-primary/10" />
                      <span className="text-[10px] uppercase tracking-[0.2em] text-foreground/55 font-medium">{g.date}</span>
                      <div className="h-px flex-1 bg-primary/10" />
                    </div>
                    <div className="space-y-2">
                      {g.items.map((comm) => {
                        const isOut = comm.direction === 'out';
                        return (
                          <div key={comm.id} className={`flex gap-3 ${isOut ? 'flex-row-reverse' : ''}`}>
                            <div className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center ${isOut ? 'bg-violet-500/15' : 'bg-cyan-500/15'} border border-primary/15`}>
                              {isOut ? <ArrowUpRight className="w-3.5 h-3.5 text-violet-300" /> : <ArrowDownLeft className="w-3.5 h-3.5 text-cyan-300" />}
                            </div>
                            <div className={`flex-1 min-w-0 max-w-[88%] p-3 rounded-card border ${isOut ? 'bg-violet-500/8 border-violet-500/15 rounded-tr-sm' : 'bg-cyan-500/5 border-cyan-500/15 rounded-tl-sm'}`}>
                              <div className="flex items-center gap-2 flex-wrap mb-1">
                                <span className="typo-caption font-medium text-foreground/85">{isOut ? 'Sent' : 'Received'}</span>
                                <span className="px-1.5 py-0.5 text-[9px] uppercase tracking-wider rounded-full bg-card/60 text-foreground/65 border border-primary/10">{comm.channel}</span>
                                {comm.contact_handle && <span className="typo-caption text-foreground/55 truncate">· {comm.contact_handle}</span>}
                                <span className="typo-caption text-foreground/45 ml-auto tabular-nums">{new Date(comm.occurred_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                              </div>
                              <p className="typo-body text-foreground/90 leading-relaxed line-clamp-4">{comm.content}</p>
                              {comm.summary && (
                                <p className="flex items-start gap-1.5 typo-caption text-foreground/65 mt-2 italic">
                                  <Quote className="w-3 h-3 mt-0.5 flex-shrink-0 opacity-60" /> {comm.summary}
                                </p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
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
