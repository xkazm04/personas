import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRightCircle, BookOpen, CheckCircle2, XCircle, Clock, Loader2, MessageSquare, ArrowDownLeft, ArrowUpRight, Inbox, History, Library, Star, Quote, Download, X } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { useToastStore } from '@/stores/toastStore';
import { TwinEmptyState } from '../TwinEmptyState';
import { TwinWikiPanel } from '../shared/TwinWikiPanel';
import { useTranslation } from '@/i18n/useTranslation';
import * as twinApi from '@/api/twin/twin';
import { ingestDoctrineDocs } from '@/api/twin/twin';

/* ------------------------------------------------------------------ *
 *  Atelier — "Archive"
 *  Memory inbox as a vertical timeline with story cards on the left;
 *  conversations as chat-style cards grouped by date on the right.
 * ------------------------------------------------------------------ */

type MemoryFilter = 'pending' | 'approved' | 'rejected';

type RejectPreset = 'irrelevant' | 'inaccurate' | 'private' | 'wrong_tone';
const REJECT_PRESETS: ReadonlyArray<RejectPreset> = ['irrelevant', 'inaccurate', 'private', 'wrong_tone'];

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
  const { t: tFull, tx } = useTranslation();
  const t = tFull.twin;
  const activeTwinId = useSystemStore((s) => s.activeTwinId);
  const activeTwin = useSystemStore((s) => s.twinProfiles).find((tp) => tp.id === activeTwinId);
  const pendingMemories = useSystemStore((s) => s.twinPendingMemories);
  const pendingLoading = useSystemStore((s) => s.twinPendingLoading);
  const communications = useSystemStore((s) => s.twinCommunications);
  const commsLoading = useSystemStore((s) => s.twinCommsLoading);
  const fetchPending = useSystemStore((s) => s.fetchTwinPendingMemories);
  const reviewMemory = useSystemStore((s) => s.reviewTwinMemory);
  const fetchComms = useSystemStore((s) => s.fetchTwinCommunications);

  const setTwinTab = useSystemStore((s) => s.setTwinTab);
  const setPendingTrainingQuestions = useSystemStore((s) => s.setPendingTrainingQuestions);
  const [filter, setFilter] = useState<MemoryFilter>('pending');
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [digDeeperId, setDigDeeperId] = useState<string | null>(null);
  const [ingestingDocs, setIngestingDocs] = useState(false);
  // Reject reason capture — when set, the inline reason picker expands under
  // the memory card instead of immediately rejecting. The reviewer_notes column
  // already exists; the user just had no way to populate it. Format stored is
  // `<presetId>` or `<presetId>: <note>` or just `<note>` (no preset picked) —
  // future aggregation can group by the preset prefix.
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectPreset, setRejectPreset] = useState<RejectPreset | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const addToast = useToastStore((s) => s.addToast);
  const hasBoundKb = !!activeTwin?.knowledge_base_id;

  const handleIngestDocs = async () => {
    if (!activeTwinId) return;
    if (!hasBoundKb) {
      addToast(t.knowledge.ingestDocsErrorNoKb, 'error');
      return;
    }
    setIngestingDocs(true);
    try {
      const summary = await ingestDoctrineDocs(activeTwinId);
      addToast(
        tx(t.knowledge.ingestDocsSuccess, {
          files: summary.filesIngested,
          chunks: summary.chunksAdded,
          skipped: summary.filesSkipped,
        }),
        'success',
      );
    } catch (err) {
      addToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setIngestingDocs(false);
    }
  };

  useEffect(() => {
    if (activeTwinId) { fetchPending(activeTwinId, filter); fetchComms(activeTwinId); }
  }, [activeTwinId, filter, fetchPending, fetchComms]);

  const handleReview = async (id: string, approved: boolean, reviewerNotes?: string) => {
    setReviewingId(id);
    try { await reviewMemory(id, approved, reviewerNotes); } finally { setReviewingId(null); }
  };

  // Mirror of the Reflections "Dig deeper" loop (cycle 5) for memories:
  // approve + generate 2 follow-up training questions from this memory's body
  // + hand off via the shared pendingTrainingQuestions slot + jump to Training.
  // Reuses generateBio so all twin AI surfaces share one retry/timeout policy.
  const handleDigDeeper = async (memId: string, memTitle: string | null, memContent: string) => {
    if (!activeTwin || !activeTwinId || digDeeperId) return;
    setDigDeeperId(memId);
    try {
      const seed = memTitle ? `${memTitle} — ${memContent}` : memContent;
      const prompt = `Below is a recently-approved memory about ${activeTwin.name}${activeTwin.role ? ` (${activeTwin.role})` : ''}. Your job: generate exactly 2 specific, conversational interview questions that would help ${activeTwin.name} elaborate on what this memory captures — angles a thoughtful interviewer would explore next, not generic prompts and not re-asking what the memory already says.

Output ONLY the 2 questions, one per line, numbered 1-2. No preamble.

Memory: ${seed}`;
      const result = await twinApi.generateBio(activeTwin.name, activeTwin.role ?? null, prompt);
      const questions = result
        .split('\n')
        .map((l) => l.replace(/^\d+[.)]\s*/, '').trim())
        .filter((l) => l.length > 8)
        .slice(0, 2);
      if (questions.length === 0) {
        addToast(t.knowledge.digDeeperError, 'error');
        return;
      }
      // Approve the memory inline as part of the dig-deeper gesture — the
      // user's "dig deeper" is a stronger signal than approve alone, and a
      // memory that prompted a follow-up shouldn't sit in pending limbo.
      await reviewMemory(memId, true, 'dig_deeper');
      setPendingTrainingQuestions(questions);
      addToast(t.knowledge.digDeeperToast, 'success');
      setTwinTab('training');
    } catch (e) {
      addToast(e instanceof Error ? e.message : t.knowledge.digDeeperError, 'error');
    } finally {
      setDigDeeperId(null);
    }
  };

  const openRejectFlow = (id: string) => {
    setRejectingId(id);
    setRejectPreset(null);
    setRejectNote('');
  };
  const cancelRejectFlow = () => {
    setRejectingId(null);
    setRejectPreset(null);
    setRejectNote('');
  };
  const confirmRejectFlow = async (id: string) => {
    const note = rejectNote.trim();
    const composed = rejectPreset
      ? note ? `${rejectPreset}: ${note}` : rejectPreset
      : note || undefined;
    cancelRejectFlow();
    await handleReview(id, false, composed);
  };

  const presetLabel = (preset: RejectPreset): string => {
    switch (preset) {
      case 'irrelevant': return t.knowledge.rejectReasonIrrelevant;
      case 'inaccurate': return t.knowledge.rejectReasonInaccurate;
      case 'private': return t.knowledge.rejectReasonPrivate;
      case 'wrong_tone': return t.knowledge.rejectReasonWrongTone;
    }
  };

  // Stored reviewer_notes are either `<preset>` / `<preset>: <note>` / `<note>`.
  // Resolve the preset prefix to its localized label so the UI never echoes a
  // raw machine token at the user.
  const renderStoredReason = (notes: string): string => {
    const split = notes.indexOf(':');
    const head = split >= 0 ? notes.slice(0, split).trim() : notes.trim();
    const tail = split >= 0 ? notes.slice(split + 1).trim() : '';
    const matched = (REJECT_PRESETS as readonly string[]).includes(head)
      ? presetLabel(head as RejectPreset)
      : null;
    if (matched && tail) return `${matched} — ${tail}`;
    if (matched) return matched;
    return notes;
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
      {/* min-w-[80vw] mirrors the ContentHeader / TwinHeaderBand contract. */}
      <div className="flex-shrink-0 relative overflow-hidden border-b border-primary/10 min-w-[80vw]">
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
            <p className="text-[10px] uppercase tracking-[0.22em] text-violet-300/80 font-medium">{t.knowledge.eyebrowAtelier}</p>
            <h1 className="typo-heading-lg text-foreground/95">{t.knowledge.title} — {activeTwin?.name ?? ''}</h1>
            <p className="typo-caption text-foreground mt-0.5">{t.knowledge.subtitle}</p>
          </div>
          <div className="hidden md:flex items-center gap-3 px-3 py-2 rounded-full border border-primary/15 bg-card/40">
            <Stat label={t.knowledge.statPending} value={stats.pending} accent={stats.pending > 10 ? 'amber' : 'violet'} />
            <span className="w-px h-6 bg-primary/15" />
            <Stat label={t.knowledge.statApproved} value={stats.approved} accent="emerald" />
            <span className="w-px h-6 bg-primary/15" />
            <Stat label={t.knowledge.statRejected} value={stats.rejected} />
            <span className="w-px h-6 bg-primary/15" />
            <Stat label={t.knowledge.statConversations} value={communications.length} />
          </div>
        </div>
      </div>

      {/* ── Wiki panel (Direction 4 — collapsed by default) ────────── */}
      <TwinWikiPanel activeTwinId={activeTwinId} />

      {/* ── Seed-from-docs panel ─────────────────────────────────── */}
      <div className="px-4 md:px-6 xl:px-8 py-3 border-b border-primary/10 flex items-center gap-4">
        <div className="w-9 h-9 rounded-card bg-cyan-500/10 border border-cyan-400/30 flex items-center justify-center flex-shrink-0">
          <Download className="w-4 h-4 text-cyan-300" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="typo-card-label text-foreground/90">{t.knowledge.ingestDocsTitle}</p>
          <p className="typo-caption text-foreground">{t.knowledge.ingestDocsDescription}</p>
        </div>
        <button
          type="button"
          onClick={handleIngestDocs}
          disabled={ingestingDocs || !hasBoundKb}
          data-testid="twin-ingest-docs-button"
          className="px-3 py-1.5 rounded-interactive text-[12px] font-medium border border-cyan-400/30 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/20 hover:border-cyan-400/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
        >
          {ingestingDocs ? (
            <>
              <Clock className="w-3 h-3 animate-spin" />
              {t.knowledge.ingestDocsLoading}
            </>
          ) : (
            <>
              <Download className="w-3 h-3" />
              {t.knowledge.ingestDocsButton}
            </>
          )}
        </button>
      </div>

      {/* ── Body ─────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-hidden grid grid-cols-1 lg:grid-cols-2">

        {/* LEFT — Memory timeline */}
        <section className="border-r border-primary/10 flex flex-col min-h-0">
          <div className="px-4 md:px-6 py-4 border-b border-primary/5 flex items-center gap-3">
            <Inbox className="w-4 h-4 text-violet-300" />
            <h2 className="typo-section-title">{t.knowledge.memoryInbox}</h2>
            <span className={`px-2 py-0.5 text-[10px] font-medium rounded-full border ${stats.pending > 0 ? 'bg-amber-500/15 text-amber-300 border-amber-500/25' : 'bg-secondary/40 text-foreground border-primary/10'}`}>
              {tx(t.knowledge.pendingCount, { count: stats.pending })}
            </span>
            <div className="ml-auto flex items-center gap-1 rounded-full border border-primary/10 bg-secondary/30 p-0.5">
              {(['pending', 'approved', 'rejected'] as const).map((f) => {
                const labelMap = { pending: t.knowledge.filterPending, approved: t.knowledge.filterApproved, rejected: t.knowledge.filterRejected } as const;
                return (
                  <button key={f} onClick={() => setFilter(f)} className={`px-2.5 py-0.5 text-[11px] rounded-full transition-colors ${filter === f ? 'bg-violet-500/20 text-violet-200' : 'text-foreground hover:text-foreground'}`}>
                    {labelMap[f]}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4">
            {pendingLoading ? (
              <div className="flex items-center justify-center py-12"><Clock className="w-5 h-5 text-foreground animate-spin" /></div>
            ) : pendingMemories.length === 0 ? (
              <div className="py-12 text-center">
                <Inbox className="w-10 h-10 text-foreground mx-auto mb-3" />
                <p className="typo-body text-foreground">{filter === 'pending' ? t.knowledge.inboxEmpty : tx(t.knowledge.noFilteredMemories, { filter })}</p>
                <p className="typo-caption text-foreground mt-1">{filter === 'pending' ? t.knowledge.newMemoriesHint : t.knowledge.switchToPending}</p>
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
                          {mem.channel && <span className="px-1.5 py-0.5 text-[9px] uppercase tracking-wider rounded-full bg-secondary/40 text-foreground">{mem.channel}</span>}
                          {mem.importance > 3 && (
                            <span className="flex items-center gap-1 px-1.5 py-0.5 text-[9px] rounded-full bg-violet-500/15 text-violet-300 border border-violet-500/25">
                              <Star className="w-2.5 h-2.5" /> {tx(t.knowledge.priorityWithCount, { count: mem.importance })}
                            </span>
                          )}
                          <span className="typo-caption text-foreground">{new Date(mem.created_at).toLocaleDateString()}</span>
                          {isPending && (
                            <div className="ml-auto flex items-center gap-1">
                              <button onClick={() => handleReview(mem.id, true)} disabled={isReviewing || rejectingId !== null || digDeeperId !== null} className="px-2 py-1 rounded-interactive text-[11px] font-medium text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors flex items-center gap-1 disabled:opacity-50">
                                <CheckCircle2 className="w-3 h-3" /> {t.knowledge.approveAction}
                              </button>
                              <button
                                onClick={() => void handleDigDeeper(mem.id, mem.title, mem.content)}
                                disabled={isReviewing || rejectingId !== null || digDeeperId !== null}
                                title={t.knowledge.digDeeperTooltip}
                                className="px-2 py-1 rounded-interactive text-[11px] font-medium text-violet-300 bg-violet-500/10 border border-violet-500/20 hover:bg-violet-500/20 transition-colors flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {digDeeperId === mem.id
                                  ? <Loader2 className="w-3 h-3 animate-spin" />
                                  : <ArrowRightCircle className="w-3 h-3" />}
                                {digDeeperId === mem.id ? t.knowledge.digDeeperGenerating : t.knowledge.digDeeperCta}
                              </button>
                              <button onClick={() => openRejectFlow(mem.id)} disabled={isReviewing || rejectingId !== null || digDeeperId !== null} className="px-2 py-1 rounded-interactive text-[11px] font-medium text-red-300 bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 transition-colors flex items-center gap-1 disabled:opacity-50">
                                <XCircle className="w-3 h-3" /> {t.knowledge.rejectAction}
                              </button>
                            </div>
                          )}
                          {!isPending && (
                            <span className={`ml-auto px-2 py-0.5 text-[9px] uppercase tracking-wider rounded-full ${mem.status === 'approved' ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/25' : 'bg-red-500/10 text-red-300 border border-red-500/20'}`}>{mem.status}</span>
                          )}
                        </div>
                        {/* Inline reject reason picker — appears under the row the
                            user just chose to reject. The reviewer_notes column
                            already exists; this populates it. */}
                        <AnimatePresence>
                          {rejectingId === mem.id && (
                            <motion.div
                              initial={{ opacity: 0, height: 0, marginTop: 0 }}
                              animate={{ opacity: 1, height: 'auto', marginTop: 12 }}
                              exit={{ opacity: 0, height: 0, marginTop: 0 }}
                              className="overflow-hidden border-t border-red-500/15 pt-3"
                            >
                              <div className="flex items-center justify-between mb-2">
                                <p className="text-[10px] uppercase tracking-[0.18em] text-red-300/85 font-medium">{t.knowledge.rejectReasonHeading}</p>
                                <button onClick={cancelRejectFlow} aria-label={t.knowledge.rejectReasonCancel} className="text-foreground hover:text-foreground">
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                              <div className="flex flex-wrap gap-1.5 mb-2">
                                {REJECT_PRESETS.map((p) => (
                                  <button
                                    key={p}
                                    type="button"
                                    onClick={() => setRejectPreset(rejectPreset === p ? null : p)}
                                    className={`px-2 py-1 text-[10px] rounded-full border transition-colors ${
                                      rejectPreset === p
                                        ? 'bg-red-500/15 text-red-200 border-red-500/35'
                                        : 'bg-secondary/40 text-foreground border-primary/10 hover:bg-red-500/8 hover:text-red-300'
                                    }`}
                                  >
                                    {presetLabel(p)}
                                  </button>
                                ))}
                              </div>
                              <textarea
                                rows={2}
                                placeholder={t.knowledge.rejectReasonNotePlaceholder}
                                value={rejectNote}
                                onChange={(e) => setRejectNote(e.target.value)}
                                className="w-full resize-y rounded-interactive border border-primary/15 bg-background px-2.5 py-1.5 typo-caption text-foreground placeholder:text-foreground/50 focus:border-red-500/40 focus:outline-none"
                              />
                              <div className="flex justify-end gap-2 mt-2">
                                <button onClick={cancelRejectFlow} className="px-2 py-1 rounded-interactive text-[11px] text-foreground hover:bg-secondary/40 transition-colors">{t.knowledge.rejectReasonCancel}</button>
                                <button
                                  onClick={() => void confirmRejectFlow(mem.id)}
                                  disabled={isReviewing || (!rejectPreset && !rejectNote.trim())}
                                  className="px-2 py-1 rounded-interactive text-[11px] font-medium text-red-200 bg-red-500/15 border border-red-500/30 hover:bg-red-500/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
                                >
                                  <XCircle className="w-3 h-3" /> {t.knowledge.rejectReasonConfirm}
                                </button>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                        {/* When viewing rejected memories, surface the stored reason
                            so the user can see what they previously thought. */}
                        {mem.status === 'rejected' && mem.reviewer_notes && (
                          <p className="mt-2 pt-2 border-t border-red-500/10 text-[10px] italic text-red-300/85">
                            {tx(t.knowledge.rejectedReasonLabel, { reason: renderStoredReason(mem.reviewer_notes) })}
                          </p>
                        )}
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
            <span className="text-[10px] uppercase tracking-wider text-foreground ml-auto">{tx(communications.length === 1 ? t.knowledge.entriesCount_one : t.knowledge.entriesCount_other, { count: communications.length })}</span>
          </div>
          <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4">
            {commsLoading ? (
              <div className="flex items-center justify-center py-12"><Clock className="w-5 h-5 text-foreground animate-spin" /></div>
            ) : communications.length === 0 ? (
              <div className="py-12 text-center">
                <MessageSquare className="w-10 h-10 text-foreground mx-auto mb-3" />
                <p className="typo-body text-foreground">{t.knowledge.noConversationsYet}</p>
                <p className="typo-caption text-foreground mt-1">{t.knowledge.conversationsHint}</p>
              </div>
            ) : (
              <div className="space-y-5 max-w-2xl">
                {grouped.map((g) => (
                  <div key={g.date}>
                    <div className="flex items-center gap-2 mb-2 sticky top-0 bg-background/80 backdrop-blur py-1.5 z-[1]">
                      <div className="h-px flex-1 bg-primary/10" />
                      <span className="text-[10px] uppercase tracking-[0.2em] text-foreground font-medium">{g.date}</span>
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
                                <span className="typo-caption font-medium text-foreground/85">{isOut ? t.knowledge.sent : t.knowledge.received}</span>
                                <span className="px-1.5 py-0.5 text-[9px] uppercase tracking-wider rounded-full bg-card/60 text-foreground border border-primary/10">{comm.channel}</span>
                                {comm.contact_handle && <span className="typo-caption text-foreground truncate">· {comm.contact_handle}</span>}
                                <span className="typo-caption text-foreground ml-auto tabular-nums">{new Date(comm.occurred_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                              </div>
                              <p className="typo-body text-foreground/90 leading-relaxed line-clamp-4">{comm.content}</p>
                              {comm.summary && (
                                <p className="flex items-start gap-1.5 typo-caption text-foreground mt-2 italic">
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
      <span className="text-[9px] uppercase tracking-[0.18em] text-foreground">{label}</span>
    </div>
  );
}
