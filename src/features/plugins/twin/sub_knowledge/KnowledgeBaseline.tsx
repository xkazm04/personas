import { useEffect, useMemo, useState } from 'react';
import { BookOpen, CheckCircle2, XCircle, Clock, MessageSquare, ArrowDownLeft, ArrowUpRight, Inbox, History, X } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { useToastStore } from '@/stores/toastStore';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { TwinEmptyState } from '../TwinEmptyState';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import { CoachMark } from '../CoachMark';

type MemoryFilter = 'pending' | 'approved' | 'rejected';

export default function KnowledgeBaseline() {
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
  const addToast = useToastStore((s) => s.addToast);

  const [filter, setFilter] = useState<MemoryFilter>('pending');
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkRunning, setBulkRunning] = useState(false);

  useEffect(() => {
    if (activeTwinId) { fetchPending(activeTwinId, filter); fetchComms(activeTwinId); }
  }, [activeTwinId, filter, fetchPending, fetchComms]);

  // Clear selection whenever the underlying filter changes — the previously
  // selected ids may not even render in the new view.
  useEffect(() => { setSelected(new Set()); }, [filter, activeTwinId]);

  const handleReview = async (id: string, approved: boolean) => {
    setReviewingId(id);
    try { await reviewMemory(id, approved); } finally { setReviewingId(null); }
  };

  const visiblePendingIds = useMemo(
    () => pendingMemories.filter((m) => m.status === 'pending').map((m) => m.id),
    [pendingMemories],
  );

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const allVisibleSelected = visiblePendingIds.length > 0 && visiblePendingIds.every((id) => selected.has(id));
  const toggleAllVisible = () => {
    if (allVisibleSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(visiblePendingIds));
    }
  };

  const runBulk = async (approved: boolean) => {
    if (selected.size === 0 || bulkRunning) return;
    setBulkRunning(true);
    const ids = Array.from(selected);
    let succeeded = 0;
    let failed = 0;
    // Sequential — sqlite single-writer + we want a stable, predictable order
    // in the inbox after the bulk. ~10/s on the local DB is plenty.
    for (const id of ids) {
      try {
        await reviewMemory(id, approved);
        succeeded += 1;
      } catch (e) {
        failed += 1;
        toastCatch('twin:knowledge-bulk-review')(e);
      }
    }
    setBulkRunning(false);
    setSelected(new Set());
    if (failed === 0) {
      addToast(
        tx(approved ? t.knowledge.bulkApprovedToast : t.knowledge.bulkRejectedToast, { count: succeeded }),
        'success',
      );
    } else {
      addToast(
        tx(t.knowledge.bulkPartialToast, { succeeded, failed }),
        succeeded > 0 ? 'success' : 'error',
      );
    }
  };

  if (!activeTwinId) return <TwinEmptyState icon={BookOpen} title={t.knowledge.title} />;

  const pendingCount = pendingMemories.filter((m) => m.status === 'pending').length;

  return (
    <ContentBox>
      <ContentHeader icon={<BookOpen className="w-5 h-5 text-violet-400" />} iconColor="violet" title={`${t.knowledge.title} — ${activeTwin?.name ?? ''}`} subtitle={t.knowledge.subtitle} />
      <ContentBody>
        <div className="flex flex-col gap-4 pb-8">
          <CoachMark id="knowledge" title={t.coach.knowledgeTitle} body={t.coach.knowledgeBody} />
          {pendingCount > 10 && filter !== 'pending' && (
            <div className="p-3 rounded-card border border-amber-500/25 bg-amber-500/5 flex items-center gap-3">
              <Inbox className="w-4 h-4 text-amber-400 flex-shrink-0" />
              <p className="typo-caption text-foreground flex-1">{t.nudges.memoryBacklog.replace('{count}', String(pendingCount))}</p>
              <button onClick={() => setFilter('pending')} className="px-2.5 py-1 text-[11px] font-medium text-amber-400 bg-amber-500/10 border border-amber-500/25 rounded-interactive hover:bg-amber-500/20 transition-colors flex-shrink-0">{t.nudges.memoryBacklogCta}</button>
            </div>
          )}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <section className="flex flex-col min-h-0">
              <div className="p-4 rounded-card border border-primary/10 bg-card/40 flex flex-col flex-1">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Inbox className="w-4 h-4 text-violet-400" />
                    <h2 className="typo-section-title">{t.knowledge.memoryInbox}</h2>
                    {pendingCount > 0 && <span className="px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/25">{pendingCount}</span>}
                  </div>
                  <div className="flex items-center gap-1">
                    {(['pending', 'approved', 'rejected'] as const).map((f) => {
                      const labelMap = { pending: t.knowledge.filterPending, approved: t.knowledge.filterApproved, rejected: t.knowledge.filterRejected } as const;
                      return (
                        <button key={f} onClick={() => setFilter(f)} className={`px-2.5 py-1 text-[11px] rounded-interactive transition-colors capitalize ${filter === f ? 'bg-violet-500/10 text-violet-400 border border-violet-500/20' : 'text-foreground hover:bg-secondary/40 border border-transparent'}`}>
                          {labelMap[f]}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <p className="typo-caption text-foreground mb-3">{t.knowledge.memoryExplanation}</p>
                {filter === 'pending' && visiblePendingIds.length > 0 && (
                  <div className="mb-2 flex items-center gap-2 px-2 py-1.5 rounded-interactive border border-primary/10 bg-secondary/30">
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={toggleAllVisible}
                        className="accent-violet-500"
                        aria-label={t.knowledge.bulkSelectAll}
                      />
                      <span className="typo-caption text-foreground">
                        {selected.size === 0
                          ? t.knowledge.bulkSelectAll
                          : tx(t.knowledge.bulkSelectedCount, { count: selected.size })}
                      </span>
                    </label>
                    {selected.size > 0 && (
                      <div className="ml-auto flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => runBulk(true)}
                          disabled={bulkRunning}
                          className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-interactive text-emerald-400 bg-emerald-500/10 border border-emerald-500/25 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
                        >
                          <CheckCircle2 className="w-3 h-3" />
                          {tx(t.knowledge.bulkApproveCta, { count: selected.size })}
                        </button>
                        <button
                          type="button"
                          onClick={() => runBulk(false)}
                          disabled={bulkRunning}
                          className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-interactive text-red-400 bg-red-500/10 border border-red-500/25 hover:bg-red-500/20 transition-colors disabled:opacity-50"
                        >
                          <XCircle className="w-3 h-3" />
                          {tx(t.knowledge.bulkRejectCta, { count: selected.size })}
                        </button>
                        <button
                          type="button"
                          onClick={() => setSelected(new Set())}
                          disabled={bulkRunning}
                          aria-label={t.knowledge.bulkClear}
                          title={t.knowledge.bulkClear}
                          className="p-1 rounded-interactive text-foreground hover:bg-secondary/40 transition-colors disabled:opacity-50"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                )}
                <div className="flex-1 overflow-y-auto space-y-2">
                  {pendingLoading ? (
                    <div className="flex items-center justify-center py-12"><Clock className="w-5 h-5 text-foreground animate-spin" /></div>
                  ) : pendingMemories.length === 0 ? (
                    <div className="py-8 text-center">
                      <Inbox className="w-8 h-8 text-foreground mx-auto mb-2" />
                      <p className="typo-body text-foreground">{filter === 'pending' ? t.knowledge.inboxEmpty : t.knowledge.noFilteredMemories.replace('{filter}', filter)}</p>
                      <p className="typo-caption text-foreground mt-1">{filter === 'pending' ? t.knowledge.newMemoriesHint : t.knowledge.switchToPending}</p>
                    </div>
                  ) : pendingMemories.map((mem) => {
                    const isReviewing = reviewingId === mem.id;
                    const isPending = mem.status === 'pending';
                    const isSelected = selected.has(mem.id);
                    return (
                      <div key={mem.id} className={`p-3 rounded-card border transition-colors ${isPending ? 'border-amber-500/20 bg-amber-500/5' : mem.status === 'approved' ? 'border-emerald-500/15 bg-emerald-500/5' : 'border-red-500/15 bg-red-500/5'} ${isSelected ? 'ring-1 ring-violet-400/50' : ''}`}>
                        <div className="flex items-start gap-3">
                          {isPending && (
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleOne(mem.id)}
                              disabled={bulkRunning}
                              aria-label={t.knowledge.bulkRowSelect}
                              className="mt-1 accent-violet-500 flex-shrink-0"
                            />
                          )}
                          <div className="flex-1 min-w-0">
                            {mem.title && <p className="typo-caption text-foreground font-medium">{mem.title}</p>}
                            <p className="typo-body text-foreground mt-0.5">{mem.content}</p>
                            <div className="flex items-center gap-3 mt-2">
                              {mem.channel && <span className="px-1.5 py-0.5 text-[9px] rounded-full bg-secondary/40 text-foreground">{mem.channel}</span>}
                              <span className="typo-caption text-foreground">{new Date(mem.created_at).toLocaleDateString()}</span>
                              {mem.importance > 3 && <span className="px-1.5 py-0.5 text-[9px] rounded-full bg-violet-500/15 text-violet-400">{t.knowledge.priority} {mem.importance}</span>}
                            </div>
                          </div>
                          {isPending ? (
                            <div className="flex items-center gap-1 flex-shrink-0">
                              <button onClick={() => handleReview(mem.id, true)} disabled={isReviewing || bulkRunning} aria-label={t.knowledge.approveTitle} title={t.knowledge.approveTitle} className="p-1.5 rounded-interactive text-foreground hover:text-emerald-400 hover:bg-emerald-500/10 transition-colors disabled:opacity-50"><CheckCircle2 className="w-4 h-4" /></button>
                              <button onClick={() => handleReview(mem.id, false)} disabled={isReviewing || bulkRunning} aria-label={t.knowledge.rejectTitle} title={t.knowledge.rejectTitle} className="p-1.5 rounded-interactive text-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"><XCircle className="w-4 h-4" /></button>
                            </div>
                          ) : (
                            <span className={`px-2 py-0.5 text-[10px] font-medium rounded-full border flex-shrink-0 ${mem.status === 'approved' ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25' : 'bg-red-500/15 text-red-400 border-red-500/25'}`}>{mem.status}</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>

            <section className="flex flex-col min-h-0">
              <div className="p-4 rounded-card border border-primary/10 bg-card/40 flex flex-col flex-1">
                <div className="flex items-center gap-2 mb-4">
                  <History className="w-4 h-4 text-violet-400" />
                  <h2 className="typo-section-title">{t.knowledge.conversationHistory}</h2>
                </div>
                <p className="typo-caption text-foreground mb-3">{t.knowledge.conversationExplanation}</p>
                <div className="flex-1 overflow-y-auto space-y-2">
                  {commsLoading ? (
                    <div className="flex items-center justify-center py-12"><Clock className="w-5 h-5 text-foreground animate-spin" /></div>
                  ) : communications.length === 0 ? (
                    <div className="py-8 text-center">
                      <MessageSquare className="w-8 h-8 text-foreground mx-auto mb-2" />
                      <p className="typo-body text-foreground">{t.knowledge.noConversationsYet}</p>
                      <p className="typo-caption text-foreground mt-1">{t.knowledge.conversationsHint}</p>
                    </div>
                  ) : communications.map((comm) => {
                    const isOut = comm.direction === 'out';
                    return (
                      <div key={comm.id} className="p-3 rounded-card border border-primary/5 bg-background/60">
                        <div className="flex items-start gap-2.5">
                          <div className={`w-6 h-6 rounded-interactive flex items-center justify-center flex-shrink-0 mt-0.5 ${isOut ? 'bg-violet-500/10' : 'bg-cyan-500/10'}`}>
                            {isOut ? <ArrowUpRight className="w-3 h-3 text-violet-400" /> : <ArrowDownLeft className="w-3 h-3 text-cyan-400" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="typo-caption text-foreground font-medium">{isOut ? t.knowledge.sent : t.knowledge.received}</span>
                              <span className="px-1.5 py-0.5 text-[9px] rounded-full bg-secondary/40 text-foreground">{comm.channel}</span>
                              {comm.contact_handle && <span className="typo-caption text-foreground">{comm.contact_handle}</span>}
                              <span className="typo-caption text-foreground ml-auto">{new Date(comm.occurred_at).toLocaleString()}</span>
                            </div>
                            <p className="typo-body text-foreground mt-1 line-clamp-3">{comm.content}</p>
                            {comm.summary && <p className="typo-caption text-foreground mt-1 italic">{comm.summary}</p>}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>
          </div>
        </div>
      </ContentBody>
    </ContentBox>
  );
}
