import { useState, useMemo, useCallback, useEffect, type ReactNode } from 'react';
import { Send, X, Hourglass, CheckSquare, Square } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { BaseModal } from '@/lib/ui/BaseModal';
import { useTranslation } from '@/i18n/useTranslation';
import { useToastStore } from '@/stores/toastStore';
import { useSystemStore } from '@/stores/systemStore';
import { writeInput } from '@/api/fleet/fleet';
import { mapWithConcurrency } from '@/lib/concurrency';
import { FleetStatusDots } from './FleetStatusDots';
import { DebtText, debtText } from '@/i18n/DebtText';


/**
 * Broadcast composer — pulled out of the former Decisions tab and into a
 * modal triggered from the Sessions view's action row. Keeps the Sessions
 * tab the single home for every operation.
 *
 * Writes the same UTF-8 text (optionally with a trailing \r) to every
 * selected session's PTY stdin via fleet_write_input. Tracks partial
 * failures and toasts a summary; per-session errors do not abort the batch.
 */
/**
 * How many PTY writes are in flight at once during a broadcast.
 *
 * Chosen, not inherited from the selection size: a broadcast is one small
 * stdin write per session, so a handful of lanes already collapses the batch
 * to a few round trips, while a wedged PTY can only stall its own lane instead
 * of the whole fleet behind it.
 */
const BROADCAST_CONCURRENCY = 8;

interface Props {
  open: boolean;
  onClose: () => void;
  /**
   * When provided, the composer is seeded with this text each time the modal
   * opens (and the target selection is reset). Used by the skill browser to
   * pre-fill a `/skill-name ` command. Leaving it undefined preserves the
   * plain broadcast behaviour — the composer persists across open/close until
   * a send clears it.
   */
  initialText?: string;
  /** Optional heading override. Defaults to the broadcast title. */
  title?: ReactNode;
}

export function FleetBroadcastModal({ open, onClose, initialText, title }: Props) {
  const { t, tx } = useTranslation();
  const sessions = useSystemStore((s) => s.fleetSessions);
  const fleetRefresh = useSystemStore((s) => s.fleetRefresh);

  const [text, setText] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pressEnter, setPressEnter] = useState(true);
  const [sending, setSending] = useState(false);
  // How far the current batch has got. "Sending…" alone told the operator that
  // something was happening and nothing about how much of the fleet had heard
  // it yet.
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  // Ids of the sessions the LAST send could not reach. "Sent to 3 of 7 — 4
  // failed" told the operator that something went wrong and nothing about
  // where; with a fleet of interactive agents that is the difference between a
  // one-click retry and four sessions silently sitting on the old instruction.
  const [failedIds, setFailedIds] = useState<string[]>([]);

  // Seed the composer + reset targets whenever the modal opens in seeded
  // mode. Scoped to `initialText !== undefined` so the broadcast call site
  // (no initialText) keeps its persist-across-open-close behaviour.
  useEffect(() => {
    if (open && initialText !== undefined) {
      setText(initialText);
      setSelected(new Set());
      setFailedIds([]);
    }
  }, [open, initialText]);

  // Sync the live session list when the modal opens. The store-cached
  // fleetSessions can lag Rust state, so without this the target list (and the
  // broadcast itself) could include sessions that have already exited —
  // writing into dead PTYs. Stale selections still fail per-session at send.
  useEffect(() => {
    if (open) void fleetRefresh();
  }, [open, fleetRefresh]);

  // A broadcast target must have a PTY writer to receive the text. `exited` is
  // the obvious one; `hibernated` is the trap — the row is still listed and
  // still looks alive, but hibernate FREES the process ("Hibernated — process
  // freed; resume with claude --resume"), so every write to it returns
  // "session writer dropped" and lands in the failure count. The rest of Fleet
  // already pairs the two states as terminal (the grid tile calls both
  // tombstones with "no PTY to attach"); this list was the one place that
  // filtered on `exited` alone.
  const targetable = useMemo(
    () => sessions.filter((s) => s.state !== 'exited' && s.state !== 'hibernated'),
    [sessions],
  );

  // Prune selections for sessions that are no longer targetable (exited /
  // removed). Without this the Set retains dead ids: the "N targets" counter
  // overstates the real audience and the send loop iterates ids that can only
  // fail. Returning the previous Set unchanged when nothing was pruned avoids a
  // render loop.
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const live = new Set(targetable.map((s) => s.id));
      let pruned = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (live.has(id)) next.add(id);
        else pruned = true;
      }
      return pruned ? next : prev;
    });
  }, [targetable]);
  const waiting = useMemo(
    () => targetable.filter((s) => s.state === 'awaiting_input'),
    [targetable],
  );

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const selectWaiting = useCallback(() => setSelected(new Set(waiting.map((s) => s.id))), [waiting]);
  const selectAll = useCallback(() => setSelected(new Set(targetable.map((s) => s.id))), [targetable]);
  const clearSel = useCallback(() => setSelected(new Set()), []);

  const handleSend = useCallback(async () => {
    if (!text.trim() || selected.size === 0 || sending) return;
    setSending(true);
    const payload = pressEnter ? `${text}\r` : text;
    const targets = [...selected];
    setProgress({ done: 0, total: targets.length });
    // Sent CONCURRENTLY, not one after another. Serially, a 20-session
    // broadcast was 20 round trips end to end and — worse — a single wedged PTY
    // held every session behind it, so the operator's fleet-wide instruction
    // reached the fleet in the order of its slowest member. These writes are to
    // independent PTYs; nothing about them is ordered.
    //
    // Concurrency is also what answers "no way to cancel": the batch finishes
    // in a few round trips instead of running long enough to need stopping.
    //
    // Through the shared pool, NOT `Promise.all(targets.map(…))` — a fleet-
    // scaled fan-out whose width is however many sessions the operator happened
    // to tick is a width nobody chose. Each task swallows its own failure, so
    // the pool's fail-fast propagation never fires and every target is
    // attempted.
    let done = 0;
    const outcomes = await mapWithConcurrency(targets, BROADCAST_CONCURRENCY, async (sid) => {
      try {
        await writeInput(sid, payload);
        // Keep the id, not just a tally — the caller needs to retarget.
        return null;
      } catch {
        return sid;
      } finally {
        done += 1;
        setProgress({ done, total: targets.length });
      }
    });
    const failedSids = outcomes.filter((sid): sid is string => sid !== null);
    const failed = failedSids.length;
    // Always surface the real outcome — the single most important feedback in
    // the feature is "did my fleet-wide command land?". Previously a full
    // success showed NO toast at all, and a total failure rendered "delivered to
    // 0 of N" through an error toast (read as partial success). Three explicit
    // outcomes now: all-sent (green), partial (amber), none (red).
    const total = selected.size;
    const sent = total - failed;
    const addToast = useToastStore.getState().addToast;
    if (sent === total) {
      const key =
        sent === 1 ? t.plugins.fleet.broadcast_sent_one : t.plugins.fleet.broadcast_sent_other;
      addToast(tx(key, { count: sent }), 'success');
    } else if (sent > 0) {
      addToast(tx(t.plugins.fleet.broadcast_sent_partial, { sent, total, failed }), 'warning');
    } else {
      addToast(tx(t.plugins.fleet.broadcast_failed_all, { total }), 'error');
    }
    setSending(false);
    setProgress(null);
    // ANY failure keeps the composer open and retargets the selection to
    // exactly the sessions that missed it. A broadcast that reached nobody must
    // not destroy a message the operator may have spent minutes composing; and
    // a PARTIAL failure used to close, which was the worse case — the operator
    // was told four sessions failed and given no way to learn which, so the
    // only recovery was to re-broadcast to everyone and double-submit to the
    // three that had already received it. Narrowing the selection is what makes
    // pressing Send again safe.
    if (failed > 0) {
      setFailedIds(failedSids);
      setSelected(new Set(failedSids));
      return;
    }
    setFailedIds([]);
    setText('');
    onClose();
  }, [text, selected, sending, pressEnter, onClose, t, tx]);

  // Label the failures for display. A session that vanished from the roster
  // between the send and the render falls back to its id — an opaque id the
  // operator can still match against a tile beats silently dropping the row.
  const failedLabels = useMemo(
    () =>
      failedIds.map((id) => ({
        id,
        label: sessions.find((s) => s.id === id)?.projectLabel ?? id,
      })),
    [failedIds, sessions],
  );

  return (
    <BaseModal
      isOpen={open}
      onClose={onClose}
      titleId="fleet-broadcast-title"
      size="md"
      panelClassName="bg-background border border-primary/10 rounded-2xl p-5 shadow-elevation-4"
    >
      <div data-testid="fleet-broadcast-modal">
        <div className="flex items-center justify-between mb-4">
          <h2 id="fleet-broadcast-title" className="typo-section-title">
            {title ?? <DebtText k="auto_broadcast_prompt_26edef52" />}
          </h2>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label={t.common.close}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        <label className="block mb-3">
          <span className="typo-caption font-medium text-foreground mb-1.5 block">
            {t.plugins.fleet.broadcast_message_label}
          </span>
          <textarea
            data-testid="fleet-broadcast-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={debtText("auto_type_the_prompt_to_broadcast_to_selected_s_77990da6")}
            rows={5}
            className="w-full px-3 py-2 text-md bg-secondary/40 border border-primary/10 rounded-modal text-foreground placeholder:text-foreground/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:border-primary/30 resize-none font-mono"
            autoFocus
          />
        </label>

        <label className="flex items-center gap-2 typo-caption text-foreground cursor-pointer mb-3">
          <input
            type="checkbox"
            checked={pressEnter}
            onChange={(e) => setPressEnter(e.target.checked)}
            className="rounded"
          />
          {t.plugins.fleet.broadcast_append}{' '}
          <code className="font-mono px-1 py-0.5 bg-secondary/40 rounded">↵</code>{' '}
          <DebtText k="auto_so_claude_submits_immediately_14f3a1f0" />
        </label>

        {/* Which sessions missed it. role="status" so the recovery path is
            announced, not just coloured. */}
        {/* The live region is ALWAYS mounted and starts empty — a region that is
            born with its message is not announced (census:
            live-region-born-with-its-message). */}
        <div role="status" data-testid={failedLabels.length > 0 ? 'fleet-broadcast-failed' : undefined} className={failedLabels.length > 0 ? 'mb-3 rounded-modal border border-amber-400/25 bg-amber-400/10 px-3 py-2' : ''}>
        {failedLabels.length > 0 ? (
          <>
            <p className="typo-caption text-amber-200">{t.plugins.fleet.broadcast_retry_hint}</p>
            <ul className="mt-1 flex flex-wrap gap-1.5">
              {failedLabels.map((f) => (
                <li
                  key={f.id}
                  className="rounded-interactive border border-amber-400/25 px-1.5 py-0.5 text-[12px] text-amber-100"
                >
                  {f.label}
                </li>
              ))}
            </ul>
          </>
        ) : null}
        </div>

        <div className="mb-3">
          <div className="flex items-center justify-between mb-1.5">
            <span className="typo-caption font-medium text-foreground">
              <DebtText k="auto_targets_55d96a85" />{selected.size}/{targetable.length})
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                icon={<Hourglass className="w-3 h-3" />}
                disabled={waiting.length === 0}
                onClick={selectWaiting}
              >
                <DebtText k="auto_waiting_449531f9" />{waiting.length})
              </Button>
              <Button variant="ghost" size="sm" icon={<CheckSquare className="w-3 h-3" />} onClick={selectAll}>
                {t.common.all}
              </Button>
              <Button variant="ghost" size="sm" icon={<Square className="w-3 h-3" />} onClick={clearSel}>
                {t.common.clear}
              </Button>
            </div>
          </div>
          <div className="max-h-[200px] overflow-y-auto border border-primary/10 rounded-modal p-1.5 bg-secondary/20 space-y-0.5">
            {targetable.length === 0 ? (
              <p className="text-[13px] text-foreground text-center py-3"><DebtText k="auto_no_active_sessions_0dcbde78" /></p>
            ) : (
              targetable.map((s) => {
                const isSel = selected.has(s.id);
                return (
                  <label
                    key={s.id}
                    className={`flex items-center gap-2 px-2 py-1 rounded-card cursor-pointer transition-colors ${
                      isSel ? 'bg-primary/8 border border-primary/20' : 'hover:bg-secondary/40 border border-transparent'
                    }`}
                  >
                    <input type="checkbox" checked={isSel} onChange={() => toggle(s.id)} className="rounded" />
                    <FleetStatusDots state={s.state} reason={s.stateReason} />
                    <span className="typo-caption truncate flex-1 min-w-0">{s.projectLabel}</span>
                  </label>
                );
              })
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <Button
            data-testid="fleet-broadcast-send"
            variant="primary"
            size="sm"
            icon={<Send className="w-3.5 h-3.5" />}
            disabled={!text.trim() || selected.size === 0 || sending}
            onClick={handleSend}
          >
            {sending
              ? progress
                ? tx(t.plugins.fleet.broadcast_sending_progress, {
                    done: progress.done,
                    total: progress.total,
                  })
                : t.plugins.fleet.broadcast_sending
              : tx(t.plugins.fleet.broadcast_send_to, { count: selected.size })}
          </Button>
        </div>
      </div>
    </BaseModal>
  );
}
