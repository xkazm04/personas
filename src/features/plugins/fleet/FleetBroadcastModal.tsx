import { useState, useMemo, useCallback, useEffect, type ReactNode } from 'react';
import { Send, X, Hourglass, CheckSquare, Square } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { BaseModal } from '@/lib/ui/BaseModal';
import { useToastStore } from '@/stores/toastStore';
import { useSystemStore } from '@/stores/systemStore';
import { writeInput } from '@/api/fleet/fleet';
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
  const sessions = useSystemStore((s) => s.fleetSessions);
  const fleetRefresh = useSystemStore((s) => s.fleetRefresh);

  const [text, setText] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pressEnter, setPressEnter] = useState(true);
  const [sending, setSending] = useState(false);

  // Seed the composer + reset targets whenever the modal opens in seeded
  // mode. Scoped to `initialText !== undefined` so the broadcast call site
  // (no initialText) keeps its persist-across-open-close behaviour.
  useEffect(() => {
    if (open && initialText !== undefined) {
      setText(initialText);
      setSelected(new Set());
    }
  }, [open, initialText]);

  // Sync the live session list when the modal opens. The store-cached
  // fleetSessions can lag Rust state, so without this the target list (and the
  // broadcast itself) could include sessions that have already exited —
  // writing into dead PTYs. Stale selections still fail per-session at send.
  useEffect(() => {
    if (open) void fleetRefresh();
  }, [open, fleetRefresh]);

  const targetable = useMemo(
    () => sessions.filter((s) => s.state !== 'exited'),
    [sessions],
  );
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
    let failed = 0;
    for (const sid of selected) {
      try {
        await writeInput(sid, payload);
      } catch {
        failed += 1;
      }
    }
    // Always surface the real outcome — the single most important feedback in
    // the feature is "did my fleet-wide command land?". Previously a full
    // success showed NO toast at all, and a total failure rendered "delivered to
    // 0 of N" through an error toast (read as partial success). Three explicit
    // outcomes now: all-sent (green), partial (amber), none (red).
    const total = selected.size;
    const sent = total - failed;
    const addToast = useToastStore.getState().addToast;
    if (sent === total) {
      addToast(sent === 1 ? 'Sent to 1 session' : `Sent to ${sent} sessions`, 'success');
    } else if (sent > 0) {
      addToast(`Sent to ${sent} of ${total} sessions — ${failed} failed`, 'warning');
    } else {
      addToast(`Broadcast failed — 0 of ${total} delivered`, 'error');
    }
    setSending(false);
    setText('');
    onClose();
  }, [text, selected, sending, pressEnter, onClose]);

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
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
            <X className="w-4 h-4" />
          </Button>
        </div>

        <label className="block mb-3">
          <span className="typo-caption font-medium text-foreground mb-1.5 block">Message</span>
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
          Append <code className="font-mono px-1 py-0.5 bg-secondary/40 rounded">↵</code> <DebtText k="auto_so_claude_submits_immediately_14f3a1f0" />
        </label>

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
                All
              </Button>
              <Button variant="ghost" size="sm" icon={<Square className="w-3 h-3" />} onClick={clearSel}>
                Clear
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
            Cancel
          </Button>
          <Button
            data-testid="fleet-broadcast-send"
            variant="primary"
            size="sm"
            icon={<Send className="w-3.5 h-3.5" />}
            disabled={!text.trim() || selected.size === 0 || sending}
            onClick={handleSend}
          >
            {sending ? 'Sending…' : `Send to ${selected.size}`}
          </Button>
        </div>
      </div>
    </BaseModal>
  );
}
