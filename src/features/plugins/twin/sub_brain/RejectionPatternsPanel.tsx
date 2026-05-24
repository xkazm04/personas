import { useEffect, useMemo } from 'react';
import { Filter, XCircle } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';

/**
 * Aggregates `reviewer_notes` populated by the knowledge-inbox reject-reason
 * capture (cycle 3). The reviewer_notes column is written in
 * `<preset>` / `<preset>: <note>` / `<note>` shape; this panel parses the
 * preset prefix and tallies the top 3 buckets so the user can see *why* they
 * keep pushing memories back — typically a signal that the upstream
 * extraction prompt or summary quality is off in some specific way.
 *
 * Data path: re-uses fetchTwinPendingMemories(twinId, 'rejected') and the
 * existing twinPendingMemories slice. No new IPC, no new store fields.
 */

const REJECT_PRESETS = ['irrelevant', 'inaccurate', 'private', 'wrong_tone'] as const;
type RejectPreset = (typeof REJECT_PRESETS)[number];

interface Props {
  twinId: string;
}

export function RejectionPatternsPanel({ twinId }: Props) {
  const { t: tFull, tx } = useTranslation();
  const t = tFull.twin;
  const pendingMemories = useSystemStore((s) => s.twinPendingMemories);
  const fetchPending = useSystemStore((s) => s.fetchTwinPendingMemories);

  // The Knowledge tab also calls fetchPending — this is idempotent against the
  // slice. Pulling 'rejected' here ensures the aggregate is accurate even when
  // the user hasn't visited Knowledge in this session.
  useEffect(() => {
    if (twinId) void fetchPending(twinId, 'rejected');
  }, [twinId, fetchPending]);

  const presetLabel = (preset: RejectPreset): string => {
    switch (preset) {
      case 'irrelevant': return t.knowledge.rejectReasonIrrelevant;
      case 'inaccurate': return t.knowledge.rejectReasonInaccurate;
      case 'private': return t.knowledge.rejectReasonPrivate;
      case 'wrong_tone': return t.knowledge.rejectReasonWrongTone;
    }
  };

  const { buckets, total } = useMemo(() => {
    const counts = new Map<string, number>();
    let totalRejected = 0;
    for (const m of pendingMemories) {
      if (m.twin_id !== twinId || m.status !== 'rejected') continue;
      totalRejected += 1;
      const notes = m.reviewer_notes?.trim() ?? '';
      if (!notes) {
        counts.set('__none', (counts.get('__none') ?? 0) + 1);
        continue;
      }
      const split = notes.indexOf(':');
      const head = split >= 0 ? notes.slice(0, split).trim() : notes.trim();
      if ((REJECT_PRESETS as readonly string[]).includes(head)) {
        counts.set(head, (counts.get(head) ?? 0) + 1);
      } else {
        counts.set('__other', (counts.get('__other') ?? 0) + 1);
      }
    }
    const sorted = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    return { buckets: sorted, total: totalRejected };
  }, [pendingMemories, twinId]);

  return (
    <div className="p-4 rounded-card border border-primary/10 bg-card/40">
      <div className="flex items-center gap-2 mb-1">
        <Filter className="w-4 h-4 text-rose-400" />
        <span className="typo-section-title">{t.rejectionPatterns.title}</span>
        {total > 0 && (
          <span className="px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-rose-500/10 text-rose-300 border border-rose-500/20">
            {total}
          </span>
        )}
      </div>
      <p className="typo-caption text-foreground mb-3">{t.rejectionPatterns.subtitle}</p>

      {total === 0 ? (
        <div className="py-4 text-center">
          <XCircle className="w-6 h-6 text-foreground mx-auto mb-1.5 opacity-50" />
          <p className="typo-caption text-foreground">{t.rejectionPatterns.empty}</p>
        </div>
      ) : (
        <ul className="space-y-1.5">
          {buckets.map(([key, count]) => {
            let label: string;
            let tone: string;
            if (key === '__other') {
              label = t.rejectionPatterns.otherBucket;
              tone = 'bg-secondary/40 text-foreground border-primary/10';
            } else if (key === '__none') {
              label = t.rejectionPatterns.noReasonBucket;
              tone = 'bg-secondary/30 text-foreground border-primary/10';
            } else {
              label = presetLabel(key as RejectPreset);
              tone = 'bg-rose-500/10 text-rose-200 border-rose-500/25';
            }
            const pct = total > 0 ? Math.round((count / total) * 100) : 0;
            return (
              <li key={key} className="flex items-center gap-2">
                <span className={`flex-shrink-0 px-2 py-0.5 text-[10px] font-medium rounded-full border ${tone}`}>
                  {label}
                </span>
                <div className="flex-1 h-1.5 rounded-full bg-secondary/30 overflow-hidden">
                  <div className="h-full rounded-full bg-gradient-to-r from-rose-500/40 to-rose-400/60" style={{ width: `${pct}%` }} />
                </div>
                <span className="flex-shrink-0 typo-caption tabular-nums text-foreground/85">{count}</span>
              </li>
            );
          })}
        </ul>
      )}
      {total > 0 && (
        <p className="typo-caption text-foreground mt-3 italic">
          {tx(t.rejectionPatterns.totalRejected, { count: total })}
        </p>
      )}
    </div>
  );
}
