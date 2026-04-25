import { useEffect, useMemo, useState } from 'react';
import { BookOpen, CheckCircle2, XCircle, Clock, ArrowDownLeft, ArrowUpRight, Inbox, History, Terminal } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { TwinEmptyState } from '../TwinEmptyState';
import { useTwinTranslation } from '../i18n/useTwinTranslation';

/* ------------------------------------------------------------------ *
 *  Console — "Memory Ledger"
 *  Top KPI strip + two dense tables: pending memories (with bulk
 *  actions) and conversation log.
 * ------------------------------------------------------------------ */

type MemoryFilter = 'pending' | 'approved' | 'rejected';

export default function KnowledgeConsole() {
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
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  useEffect(() => {
    if (activeTwinId) { fetchPending(activeTwinId, filter); fetchComms(activeTwinId); }
    setSelected(new Set());
  }, [activeTwinId, filter, fetchPending, fetchComms]);

  const handleReview = async (id: string, approved: boolean) => {
    setReviewingId(id);
    try { await reviewMemory(id, approved); } finally { setReviewingId(null); }
  };

  const handleBulk = async (approved: boolean) => {
    if (selected.size === 0) return;
    setBulkBusy(true);
    try {
      for (const id of selected) await reviewMemory(id, approved);
      setSelected(new Set());
    } finally { setBulkBusy(false); }
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleAll = () => {
    const ids = pendingMemories.filter((m) => m.status === 'pending').map((m) => m.id);
    if (ids.length === 0) return;
    if (selected.size === ids.length) setSelected(new Set());
    else setSelected(new Set(ids));
  };

  const stats = useMemo(() => {
    const pending = pendingMemories.filter((m) => m.status === 'pending').length;
    const approved = pendingMemories.filter((m) => m.status === 'approved').length;
    const rejected = pendingMemories.filter((m) => m.status === 'rejected').length;
    const out = communications.filter((c) => c.direction === 'out').length;
    const inbound = communications.length - out;
    return { pending, approved, rejected, total: communications.length, out, inbound };
  }, [pendingMemories, communications]);

  if (!activeTwinId) return <TwinEmptyState icon={BookOpen} title={t.knowledge.title} />;

  const pendingIds = pendingMemories.filter((m) => m.status === 'pending').map((m) => m.id);
  const allSelected = pendingIds.length > 0 && selected.size === pendingIds.length;

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      {/* ── Strip header ─────────────────────────────────────────── */}
      <div className="flex-shrink-0 flex items-center gap-3 px-4 md:px-6 xl:px-8 py-3 border-b border-primary/10 bg-card/40">
        <div className="w-8 h-8 rounded-interactive bg-violet-500/15 border border-violet-500/30 flex items-center justify-center">
          <Terminal className="w-4 h-4 text-violet-300" />
        </div>
        <div className="flex flex-col leading-tight min-w-0">
          <h1 className="typo-card-label">memory.ledger / {activeTwin?.name ?? '?'}</h1>
          <span className="typo-caption text-foreground/55 truncate">{t.knowledge.subtitle}</span>
        </div>
        <div className="flex-1" />
        <div className="flex items-stretch gap-2">
          <Tile label="pending" value={stats.pending} accent={stats.pending > 10 ? 'amber' : 'violet'} />
          <Tile label="approved" value={stats.approved} accent="emerald" />
          <Tile label="rejected" value={stats.rejected} />
          <Tile label="conv." value={stats.total} />
        </div>
      </div>

      {/* ── Body — two stacked sections ──────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {/* Memory inbox */}
        <section className="border-b border-primary/10">
          <div className="flex items-center gap-3 px-4 md:px-6 xl:px-8 py-3 border-b border-primary/5 bg-card/30">
            <Inbox className="w-4 h-4 text-violet-300" />
            <h2 className="typo-card-label">memory.inbox</h2>
            <div className="flex items-center gap-1 rounded-full border border-primary/10 bg-secondary/30 p-0.5 ml-2">
              {(['pending', 'approved', 'rejected'] as const).map((f) => {
                const labelMap = { pending: t.knowledge.filterPending, approved: t.knowledge.filterApproved, rejected: t.knowledge.filterRejected } as const;
                return (
                  <button key={f} onClick={() => setFilter(f)} className={`px-2.5 py-0.5 text-[11px] rounded-full transition-colors ${filter === f ? 'bg-violet-500/20 text-violet-200' : 'text-foreground/65 hover:text-foreground'}`}>
                    {labelMap[f]}
                  </button>
                );
              })}
            </div>
            <div className="flex-1" />
            {selected.size > 0 && filter === 'pending' && (
              <div className="flex items-center gap-2">
                <span className="typo-caption text-foreground/65 tabular-nums">{selected.size} selected</span>
                <button onClick={() => handleBulk(true)} disabled={bulkBusy} className="px-2.5 py-1 text-[11px] font-medium rounded-interactive text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> approve all
                </button>
                <button onClick={() => handleBulk(false)} disabled={bulkBusy} className="px-2.5 py-1 text-[11px] font-medium rounded-interactive text-red-300 bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 transition-colors flex items-center gap-1">
                  <XCircle className="w-3 h-3" /> reject all
                </button>
              </div>
            )}
          </div>

          <table className="w-full border-collapse text-sm">
            <thead className="bg-background/95">
              <tr className="border-b border-primary/10 text-foreground/55">
                <th className="text-left px-3 py-2 pl-4 md:pl-6 xl:pl-8 w-8">
                  {filter === 'pending' && (
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} className="accent-violet-500 cursor-pointer" />
                  )}
                </th>
                <th className="text-left px-3 py-2 w-32"><span className="text-[10px] uppercase tracking-[0.16em]">date</span></th>
                <th className="text-left px-3 py-2 w-24"><span className="text-[10px] uppercase tracking-[0.16em]">channel</span></th>
                <th className="text-left px-3 py-2"><span className="text-[10px] uppercase tracking-[0.16em]">memory</span></th>
                <th className="text-center px-3 py-2 w-16"><span className="text-[10px] uppercase tracking-[0.16em]">prio</span></th>
                <th className="text-right px-3 py-2 pr-4 md:pr-6 xl:pr-8 w-32"><span className="text-[10px] uppercase tracking-[0.16em]">action</span></th>
              </tr>
            </thead>
            <tbody>
              {pendingLoading && <tr><td colSpan={6} className="px-4 py-10 text-center"><Clock className="w-5 h-5 text-foreground/55 animate-spin inline-block" /></td></tr>}
              {!pendingLoading && pendingMemories.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-10 text-center typo-body text-foreground/65">
                  {filter === 'pending' ? t.knowledge.inboxEmpty : t.knowledge.noFilteredMemories.replace('{filter}', filter)}
                </td></tr>
              )}
              {!pendingLoading && pendingMemories.map((mem) => {
                const isReviewing = reviewingId === mem.id;
                const isPending = mem.status === 'pending';
                const isSelected = selected.has(mem.id);
                return (
                  <tr key={mem.id} className={`group border-b border-primary/5 transition-colors ${isSelected ? 'bg-violet-500/5' : 'hover:bg-secondary/20'}`}>
                    <td className="pl-4 md:pl-6 xl:pl-8 pr-3 py-2">
                      {isPending && (
                        <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(mem.id)} className="accent-violet-500 cursor-pointer" />
                      )}
                    </td>
                    <td className="px-3 py-2 typo-caption text-foreground/65 tabular-nums">{new Date(mem.created_at).toLocaleDateString()}</td>
                    <td className="px-3 py-2">
                      {mem.channel ? (
                        <span className="px-1.5 py-0.5 text-[9px] uppercase tracking-wider rounded-full bg-secondary/40 text-foreground/85">{mem.channel}</span>
                      ) : <span className="typo-caption text-foreground/40">—</span>}
                    </td>
                    <td className="px-3 py-2">
                      {mem.title && <p className="typo-caption font-medium text-foreground">{mem.title}</p>}
                      <p className="typo-body text-foreground/85 line-clamp-2">{mem.content}</p>
                    </td>
                    <td className="px-3 py-2 text-center">
                      {mem.importance > 0 ? (
                        <span className={`tabular-nums text-xs ${mem.importance > 3 ? 'text-violet-300' : 'text-foreground/65'}`}>{mem.importance}</span>
                      ) : <span className="typo-caption text-foreground/40">—</span>}
                    </td>
                    <td className="pr-4 md:pr-6 xl:pr-8 pl-3 py-2 text-right">
                      {isPending ? (
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => handleReview(mem.id, true)} disabled={isReviewing} title="approve" className="p-1 rounded-interactive text-foreground/65 hover:text-emerald-300 hover:bg-emerald-500/10 transition-colors">
                            <CheckCircle2 className="w-4 h-4" />
                          </button>
                          <button onClick={() => handleReview(mem.id, false)} disabled={isReviewing} title="reject" className="p-1 rounded-interactive text-foreground/65 hover:text-red-300 hover:bg-red-500/10 transition-colors">
                            <XCircle className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <span className={`px-2 py-0.5 text-[10px] uppercase tracking-wider font-medium rounded-full ${mem.status === 'approved' ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/25' : 'bg-red-500/10 text-red-300 border border-red-500/20'}`}>{mem.status}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        {/* Conversation log */}
        <section>
          <div className="flex items-center gap-3 px-4 md:px-6 xl:px-8 py-3 border-b border-primary/5 bg-card/30">
            <History className="w-4 h-4 text-violet-300" />
            <h2 className="typo-card-label">conversation.log</h2>
            <div className="flex-1" />
            <div className="flex items-center gap-3 typo-caption text-foreground/55">
              <span className="flex items-center gap-1"><ArrowUpRight className="w-3 h-3 text-violet-300" /> sent {stats.out}</span>
              <span className="flex items-center gap-1"><ArrowDownLeft className="w-3 h-3 text-cyan-300" /> received {stats.inbound}</span>
            </div>
          </div>
          <table className="w-full border-collapse text-sm">
            <thead className="bg-background/95">
              <tr className="border-b border-primary/10 text-foreground/55">
                <th className="text-left px-3 py-2 pl-4 md:pl-6 xl:pl-8 w-8"><span className="text-[10px] uppercase tracking-[0.16em]">dir</span></th>
                <th className="text-left px-3 py-2 w-44"><span className="text-[10px] uppercase tracking-[0.16em]">timestamp</span></th>
                <th className="text-left px-3 py-2 w-24"><span className="text-[10px] uppercase tracking-[0.16em]">channel</span></th>
                <th className="text-left px-3 py-2 w-32"><span className="text-[10px] uppercase tracking-[0.16em]">contact</span></th>
                <th className="text-left px-3 py-2 pr-4 md:pr-6 xl:pr-8"><span className="text-[10px] uppercase tracking-[0.16em]">content</span></th>
              </tr>
            </thead>
            <tbody>
              {commsLoading && <tr><td colSpan={5} className="px-4 py-10 text-center"><Clock className="w-5 h-5 text-foreground/55 animate-spin inline-block" /></td></tr>}
              {!commsLoading && communications.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-10 text-center typo-body text-foreground/65">{t.knowledge.noConversationsYet}</td></tr>
              )}
              {!commsLoading && communications.map((comm) => {
                const isOut = comm.direction === 'out';
                return (
                  <tr key={comm.id} className="border-b border-primary/5 hover:bg-secondary/20 transition-colors">
                    <td className="pl-4 md:pl-6 xl:pl-8 pr-3 py-2">
                      {isOut ? <ArrowUpRight className="w-3.5 h-3.5 text-violet-300" /> : <ArrowDownLeft className="w-3.5 h-3.5 text-cyan-300" />}
                    </td>
                    <td className="px-3 py-2 typo-caption text-foreground/65 tabular-nums whitespace-nowrap">{new Date(comm.occurred_at).toLocaleString()}</td>
                    <td className="px-3 py-2">
                      <span className="px-1.5 py-0.5 text-[9px] uppercase tracking-wider rounded-full bg-secondary/40 text-foreground/85">{comm.channel}</span>
                    </td>
                    <td className="px-3 py-2 typo-caption text-foreground/85 truncate">{comm.contact_handle ?? <span className="text-foreground/40">—</span>}</td>
                    <td className="px-3 py-2 pr-4 md:pr-6 xl:pr-8">
                      <p className="typo-body text-foreground/90 line-clamp-2">{comm.content}</p>
                      {comm.summary && <p className="typo-caption text-foreground/55 italic mt-0.5">— {comm.summary}</p>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}

function Tile({ label, value, accent = 'violet' }: { label: string; value: number | string; accent?: 'violet' | 'emerald' | 'amber' }) {
  const tone = accent === 'emerald' ? 'text-emerald-300 border-emerald-500/25' : accent === 'amber' ? 'text-amber-300 border-amber-500/25' : 'text-violet-300 border-violet-500/25';
  return (
    <div className={`rounded-interactive border ${tone} bg-card/40 px-2.5 py-1 flex flex-col items-center min-w-[64px]`}>
      <span className="typo-data-lg tabular-nums leading-none">{value}</span>
      <span className="text-[9px] uppercase tracking-[0.16em] text-foreground/55 mt-0.5">{label}</span>
    </div>
  );
}
