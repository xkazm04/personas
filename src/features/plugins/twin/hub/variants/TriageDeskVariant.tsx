/**
 * Variant "desk" — the CloneDeck triage desk.
 *
 * The pending queue is a buffer list on the left; ONE entry is framed on the
 * right with its full text, channel mark, contact and relative time. Approve /
 * Reject / Dig deeper are icon buttons bound to single keys, and the legend is
 * ALWAYS visible rather than hidden behind a help affordance. The exit carries
 * the verdict's direction, so the gesture reads as filing rather than deleting.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Inbox, Wand2, X } from 'lucide-react';
import { AsyncButton } from '@/features/shared/components/buttons';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { useTranslation } from '@/i18n/useTranslation';
import { HUB_KIND_META, HubRejectChips, isReviewable } from '../HubEntryActions';
import { HUB_REJECT_REASONS, type HubEntry, type HubVariantProps } from '../hubContract';

export default function TriageDeskVariant({ feed }: HubVariantProps) {
  const { t: tRoot, tx } = useTranslation();
  const t = tRoot.twin.hub;
  const reduced = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [rejecting, setRejecting] = useState(false);
  const [exitDir, setExitDir] = useState(1);

  const queue = useMemo(() => feed.entries.filter(isReviewable), [feed.entries]);
  const at = Math.min(index, Math.max(0, queue.length - 1));
  const current = queue[at] ?? null;
  const busy = !!current && feed.busyId === current.id;

  const file = useCallback((dir: number, fn: () => Promise<void>) => {
    setExitDir(dir);
    setRejecting(false);
    void fn();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      if (!current || busy) return;
      if (e.key === 'Escape') { setRejecting(false); return; }
      if (rejecting) {
        const pick = HUB_REJECT_REASONS[Number(e.key) - 1];
        if (pick) file(-1, () => feed.reject(current, pick));
        return;
      }
      const k = e.key.toLowerCase();
      if (k === 'a') file(1, () => feed.approve(current));
      else if (k === 'd') file(1, () => feed.digDeeper(current));
      else if (k === 'r') setRejecting(true);
      else if (e.key === 'ArrowDown') setIndex((i) => Math.min(i + 1, queue.length - 1));
      else if (e.key === 'ArrowUp') setIndex((i) => Math.max(i - 1, 0));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, busy, rejecting, queue.length, feed, file]);

  return (
    <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(0,18rem)_1fr]">
      {/* ── Buffer ─────────────────────────────────────────────────── */}
      <aside className="hidden lg:flex flex-col min-h-0 border-r border-border bg-card/20">
        <p className="flex-shrink-0 px-4 py-2 typo-label text-foreground border-b border-border">
          {t.desk.queue}
        </p>
        <ol className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1">
          {queue.map((entry, i) => {
            const meta = HUB_KIND_META[entry.kind];
            return (
              <li key={entry.id}>
                <button
                  type="button"
                  onClick={() => setIndex(i)}
                  className={`w-full text-left px-2 py-1.5 rounded-interactive flex items-start gap-2 transition-colors focus-ring ${
                    i === at ? `${meta.bg} border ${meta.border}` : 'border border-transparent hover:bg-secondary/40'
                  }`}
                >
                  <meta.Icon className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${meta.text}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block typo-caption text-foreground truncate">
                      {entry.title ?? entry.body}
                    </span>
                    <RelativeTime timestamp={entry.at} className="typo-label text-foreground tabular-nums" />
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </aside>

      {/* ── Frame ──────────────────────────────────────────────────── */}
      <section className="flex flex-col min-h-0">
        {feed.loading && queue.length === 0 ? (
          <DeskGhost />
        ) : !current ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 px-6 text-center">
            <Inbox className="w-9 h-9 text-status-success" />
            <p className="typo-body-lg text-foreground">{t.desk.emptyTitle}</p>
            <p className="typo-caption text-foreground max-w-sm">
              {feed.counts.approved + feed.counts.rejected > 0 ? t.desk.emptyReviewed : t.desk.emptyNothingCaptured}
            </p>
          </div>
        ) : (
          <AnimatePresence mode="wait" initial={false}>
            <motion.article
              key={current.id}
              initial={{ opacity: 0, y: reduced ? 0 : 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, x: reduced ? 0 : exitDir * 48 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="flex-1 min-h-0 flex flex-col"
            >
              <DeskHeader entry={current} />
              <div className="flex-1 min-h-0 overflow-y-auto px-4 md:px-8 py-4">
                <p className="typo-body-lg text-foreground whitespace-pre-wrap leading-relaxed max-w-3xl">
                  {current.body}
                </p>
              </div>

              <footer className="flex-shrink-0 border-t border-border px-4 md:px-8 py-3 space-y-2">
                {rejecting ? (
                  <HubRejectChips
                    showKeys
                    onPick={(reason) => file(-1, () => feed.reject(current, reason))}
                    onCancel={() => setRejecting(false)}
                  />
                ) : (
                  <div className="flex items-center gap-2">
                    <AsyncButton size="icon-md" variant="accent" accentColor="emerald" isLoading={busy}
                      aria-label={t.entry.approve} icon={<Check className="w-4 h-4" />}
                      onClick={() => { setExitDir(1); return feed.approve(current); }} />
                    <AsyncButton size="icon-md" variant="accent" accentColor="violet" isLoading={busy}
                      aria-label={t.entry.digDeeper} icon={<Wand2 className="w-4 h-4" />}
                      onClick={() => { setExitDir(1); return feed.digDeeper(current); }} />
                    <AsyncButton size="icon-md" variant="accent" accentColor="rose" disabled={busy}
                      aria-label={t.entry.reject} icon={<X className="w-4 h-4" />}
                      onClick={() => { setRejecting(true); }} />
                    <span className="ml-auto typo-caption text-foreground tabular-nums">
                      {tx(t.desk.position, { at: at + 1, total: queue.length })}
                    </span>
                  </div>
                )}
                <p className="typo-label text-foreground">{rejecting ? t.desk.legendReject : t.desk.legend}</p>
              </footer>
            </motion.article>
          </AnimatePresence>
        )}
      </section>
    </div>
  );
}

function DeskHeader({ entry }: { entry: HubEntry }) {
  const t = useTranslation().t.twin.hub;
  const meta = HUB_KIND_META[entry.kind];
  return (
    <header className="flex-shrink-0 px-4 md:px-8 pt-4 pb-3 border-b border-border flex items-center gap-2 flex-wrap">
      <span className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full border ${meta.bg} ${meta.border} ${meta.text}`}>
        <meta.Icon className="w-3.5 h-3.5" />
        <span className="typo-label">{t.kinds[entry.kind]}</span>
      </span>
      {entry.channel && (
        <span className="px-2 py-0.5 rounded-full border border-border bg-secondary/40 typo-label text-foreground">
          {entry.channel}
        </span>
      )}
      {entry.contactHandle && <span className="typo-caption text-foreground truncate">{entry.contactHandle}</span>}
      <RelativeTime timestamp={entry.at} className="ml-auto typo-caption text-foreground tabular-nums" />
      {entry.title && <h2 className="w-full typo-heading text-foreground">{entry.title}</h2>}
    </header>
  );
}

/** Calm, geometry-matched ghost under the permanent chrome — never a spinner. */
function DeskGhost() {
  return (
    <div className="flex-1 px-4 md:px-8 py-4 space-y-3" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <span key={i} className="block h-4 rounded bg-primary/[0.06] animate-fade-in"
          style={{ width: `${90 - i * 12}%`, animationDelay: `${120 + i * 35}ms` }} />
      ))}
    </div>
  );
}
