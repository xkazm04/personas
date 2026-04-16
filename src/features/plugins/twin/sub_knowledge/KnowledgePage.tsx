import { useEffect, useState } from 'react';
import { BookOpen, CheckCircle2, XCircle, Clock, MessageSquare, ArrowDownLeft, ArrowUpRight, Inbox, History } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { TwinEmptyState } from '../TwinEmptyState';
import { useTwinTranslation } from '../i18n/useTwinTranslation';

/**
 * Knowledge tab — two stable sections:
 *
 * 1. **Memory Inbox** — pending memories from agent interactions, awaiting
 *    human review (approve / reject). Approved items feed the twin's KB.
 *
 * 2. **Conversation History** — chronological log of all interactions
 *    recorded via the Twin connector, with direction + channel badges.
 */

type MemoryFilter = 'pending' | 'approved' | 'rejected';

export default function KnowledgePage() {
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
    if (activeTwinId) {
      fetchPending(activeTwinId, filter);
      fetchComms(activeTwinId);
    }
  }, [activeTwinId, filter, fetchPending, fetchComms]);

  const handleReview = async (id: string, approved: boolean) => {
    setReviewingId(id);
    try { await reviewMemory(id, approved); }
    finally { setReviewingId(null); }
  };

  if (!activeTwinId) return <TwinEmptyState icon={BookOpen} title={t.knowledge.title} />;

  const pendingCount = pendingMemories.filter((m) => m.status === 'pending').length;

  return (
    <ContentBox>
      <ContentHeader
        icon={<BookOpen className="w-5 h-5 text-violet-400" />}
        iconColor="violet"
        title={`${t.knowledge.title} — ${activeTwin?.name ?? ''}`}
        subtitle={t.knowledge.subtitle}
      />

      <ContentBody>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pb-8">

          {/* ── LEFT COLUMN: Memory Inbox ──────────────────────────────── */}
          <section className="flex flex-col min-h-0">
            <div className="p-4 rounded-card border border-primary/10 bg-card/40 flex flex-col flex-1">
              {/* Section header */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Inbox className="w-4 h-4 text-violet-400" />
                  <h2 className="typo-heading text-foreground">{t.knowledge.memoryInbox}</h2>
                  {pendingCount > 0 && (
                    <span className="px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/25">
                      {pendingCount}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {(['pending', 'approved', 'rejected'] as const).map((f) => {
                    const labelMap = { pending: t.knowledge.filterPending, approved: t.knowledge.filterApproved, rejected: t.knowledge.filterRejected } as const;
                    return (
                      <button
                        key={f}
                        onClick={() => setFilter(f)}
                        className={`px-2.5 py-1 text-[11px] rounded-interactive transition-colors capitalize ${
                          filter === f
                            ? 'bg-violet-500/10 text-violet-400 border border-violet-500/20'
                            : 'text-muted-foreground hover:bg-secondary/40 border border-transparent'
                        }`}
                      >
                        {labelMap[f]}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Explanation */}
              <p className="typo-caption text-muted-foreground mb-3">{t.knowledge.memoryExplanation}</p>

              {/* Content */}
              <div className="flex-1 overflow-y-auto space-y-2">
                {pendingLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Clock className="w-5 h-5 text-muted-foreground animate-spin" />
                  </div>
                ) : pendingMemories.length === 0 ? (
                  <div className="py-8 text-center">
                    <Inbox className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                    <p className="typo-body text-foreground">
                      {filter === 'pending' ? t.knowledge.inboxEmpty : t.knowledge.noFilteredMemories.replace('{filter}', filter)}
                    </p>
                    <p className="typo-caption text-muted-foreground mt-1">
                      {filter === 'pending' ? t.knowledge.newMemoriesHint : t.knowledge.switchToPending}
                    </p>
                  </div>
                ) : (
                  pendingMemories.map((mem) => {
                    const isReviewing = reviewingId === mem.id;
                    const isPending = mem.status === 'pending';
                    return (
                      <div
                        key={mem.id}
                        className={`p-3 rounded-card border transition-colors ${
                          isPending
                            ? 'border-amber-500/20 bg-amber-500/5'
                            : mem.status === 'approved'
                            ? 'border-emerald-500/15 bg-emerald-500/5'
                            : 'border-red-500/15 bg-red-500/5'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <div className="flex-1 min-w-0">
                            {mem.title && <p className="typo-caption text-foreground font-medium">{mem.title}</p>}
                            <p className="typo-body text-foreground mt-0.5">{mem.content}</p>
                            <div className="flex items-center gap-3 mt-2">
                              {mem.channel && <span className="px-1.5 py-0.5 text-[9px] rounded-full bg-secondary/40 text-muted-foreground">{mem.channel}</span>}
                              <span className="typo-caption text-muted-foreground">{new Date(mem.created_at).toLocaleDateString()}</span>
                              {mem.importance > 3 && (
                                <span className="px-1.5 py-0.5 text-[9px] rounded-full bg-violet-500/15 text-violet-400">{t.knowledge.priority} {mem.importance}</span>
                              )}
                            </div>
                          </div>
                          {isPending ? (
                            <div className="flex items-center gap-1 flex-shrink-0">
                              <button onClick={() => handleReview(mem.id, true)} disabled={isReviewing} title={t.knowledge.approveTitle} aria-label={t.knowledge.approveTitle}
                                className="p-1.5 rounded-interactive text-muted-foreground hover:text-emerald-400 hover:bg-emerald-500/10 transition-colors">
                                <CheckCircle2 className="w-4 h-4" />
                              </button>
                              <button onClick={() => handleReview(mem.id, false)} disabled={isReviewing} title={t.knowledge.rejectTitle} aria-label={t.knowledge.rejectTitle}
                                className="p-1.5 rounded-interactive text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors">
                                <XCircle className="w-4 h-4" />
                              </button>
                            </div>
                          ) : (
                            <span className={`px-2 py-0.5 text-[10px] font-medium rounded-full border flex-shrink-0 ${
                              mem.status === 'approved'
                                ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25'
                                : 'bg-red-500/15 text-red-400 border-red-500/25'
                            }`}>{mem.status}</span>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </section>

          {/* ── RIGHT COLUMN: Conversation History ────────────────────── */}
          <section className="flex flex-col min-h-0">
            <div className="p-4 rounded-card border border-primary/10 bg-card/40 flex flex-col flex-1">
              <div className="flex items-center gap-2 mb-4">
                <History className="w-4 h-4 text-violet-400" />
                <h2 className="typo-heading text-foreground">{t.knowledge.conversationHistory}</h2>
              </div>

              <p className="typo-caption text-muted-foreground mb-3">{t.knowledge.conversationExplanation}</p>

              <div className="flex-1 overflow-y-auto space-y-2">
                {commsLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Clock className="w-5 h-5 text-muted-foreground animate-spin" />
                  </div>
                ) : communications.length === 0 ? (
                  <div className="py-8 text-center">
                    <MessageSquare className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                    <p className="typo-body text-foreground">{t.knowledge.noConversationsYet}</p>
                    <p className="typo-caption text-muted-foreground mt-1">{t.knowledge.conversationsHint}</p>
                  </div>
                ) : (
                  communications.map((comm) => {
                    const isOut = comm.direction === 'out';
                    return (
                      <div key={comm.id} className="p-3 rounded-card border border-primary/5 bg-background/60">
                        <div className="flex items-start gap-2.5">
                          <div className={`w-6 h-6 rounded-interactive flex items-center justify-center flex-shrink-0 mt-0.5 ${
                            isOut ? 'bg-violet-500/10' : 'bg-cyan-500/10'
                          }`}>
                            {isOut
                              ? <ArrowUpRight className="w-3 h-3 text-violet-400" />
                              : <ArrowDownLeft className="w-3 h-3 text-cyan-400" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="typo-caption text-foreground font-medium">{isOut ? 'Sent' : 'Received'}</span>
                              <span className="px-1.5 py-0.5 text-[9px] rounded-full bg-secondary/40 text-muted-foreground">{comm.channel}</span>
                              {comm.contact_handle && <span className="typo-caption text-foreground">{comm.contact_handle}</span>}
                              <span className="typo-caption text-muted-foreground ml-auto">{new Date(comm.occurred_at).toLocaleString()}</span>
                            </div>
                            <p className="typo-body text-foreground mt-1 line-clamp-3">{comm.content}</p>
                            {comm.summary && <p className="typo-caption text-muted-foreground mt-1 italic">{comm.summary}</p>}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </section>
        </div>
      </ContentBody>
    </ContentBox>
  );
}
