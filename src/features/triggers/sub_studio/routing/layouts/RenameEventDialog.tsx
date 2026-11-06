/**
 * Modal to rename an event type across every store that references it:
 *   - persona_events (audit rows)
 *   - persona_event_subscriptions
 *   - persona_triggers.config (event_type / listen_event_type / _handler_key)
 *   - personas.structured_prompt.eventHandlers
 *
 * The rename happens atomically in the backend (see `rename_event_type` repo
 * function). This dialog is purely input + validation + feedback.
 *
 * Client-side validation mirrors the backend validator so users get instant
 * feedback instead of a round-trip for trivial errors. The backend is still
 * the source of truth for the collision + reserved-name checks.
 */
import { useEffect, useMemo, useState } from 'react';
import { Pencil, X, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { BaseModal } from '@/features/shared/components/modals';
import { inlineErrorCopy } from '@/features/triggers/lib/inlineErrorCopy';
import Button from '@/features/shared/components/buttons/Button';

const TITLE_ID = 'rename-event-dialog-title';

// Mirrors `RESERVED_EVENT_TYPES` in src-tauri/db/src/repos/resources/triggers/event_wiring.rs.
// The parity test pins this list to the backend; the backend still rejects authoritatively.
export const RESERVED_EVENT_TYPES = new Set([
  'webhook_received',
  'schedule_fired',
  'polling_changed',
  'chain_completed',
  'chain_triggered',
  'file_changed',
  'clipboard_changed',
  'app_focus_changed',
  'composite_fired',
  'trigger_fired',
  'execution_completed',
  'execution_failed',
  'persona_action',
  'emit_event',
]);

/** Mirrors `is_safe_type_string` in src-tauri/src/db/repos/communication/events.rs. */
function isSafeTypeString(s: string): boolean {
  if (s.length === 0) return false;
  const first = s.charCodeAt(0);
  const isAlnum = (c: number) =>
    (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
  if (!isAlnum(first) && first !== 95 /* _ */) return false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (
      !isAlnum(c) &&
      c !== 95 /* _ */ &&
      c !== 45 /* - */ &&
      c !== 46 /* . */ &&
      c !== 58 /* : */ &&
      c !== 47 /* / */
    ) {
      return false;
    }
  }
  return true;
}

interface Props {
  open: boolean;
  oldEventType: string;
  /** Shown so the user sees how many things will move. */
  affectedCounts: {
    sources: number;
    connections: number;
  };
  /** True if the row is a catalog (SYS) event — rename is blocked entirely. */
  reserved: boolean;
  /** Called on Confirm. The caller handles the invoke + reload. */
  onConfirm: (newEventType: string) => Promise<void> | void;
  onCancel: () => void;
}

export function RenameEventDialog({
  open,
  oldEventType,
  affectedCounts,
  reserved,
  onConfirm,
  onCancel,
}: Props) {
  const { t, tx } = useTranslation();
  const [newEventType, setNewEventType] = useState(oldEventType);
  const [busy, setBusy] = useState(false);
  // The rejection itself, resolved at render: an IPC rejection is a serialized
  // AppError object, so stringifying it here printed "[object Object]".
  const [serverError, setServerError] = useState<{ raw: unknown } | null>(null);
  const sourceReserved = reserved || RESERVED_EVENT_TYPES.has(oldEventType);

  // Reset the input whenever the dialog re-opens on a different row.
  useEffect(() => {
    if (open) {
      setNewEventType(oldEventType);
      setServerError(null);
      setBusy(false);
    }
  }, [open, oldEventType]);

  const clientError = useMemo<string | null>(() => {
    if (sourceReserved) {
      return tx(t.triggers.rename_err_reserved_source, { name: oldEventType });
    }
    const trimmed = newEventType.trim();
    if (trimmed.length === 0) return t.triggers.rename_err_empty;
    if (trimmed === oldEventType) return t.triggers.rename_err_same;
    if (trimmed.length > 128) return t.triggers.rename_err_too_long;
    if (!isSafeTypeString(trimmed)) {
      return t.triggers.rename_err_chars;
    }
    if (RESERVED_EVENT_TYPES.has(trimmed)) {
      return tx(t.triggers.rename_err_reserved_target, { name: trimmed });
    }
    return null;
  }, [newEventType, oldEventType, sourceReserved, t, tx]);

  const disabled = busy || clientError !== null;

  async function handleConfirm() {
    if (disabled) return;
    setBusy(true);
    setServerError(null);
    try {
      await onConfirm(newEventType.trim());
      // Parent closes the dialog on success.
    } catch (e) {
      setServerError({ raw: e });
      setBusy(false);
    }
  }

  return (
    <BaseModal
      isOpen={open}
      onClose={onCancel}
      titleId={TITLE_ID}
      maxWidthClass="max-w-none"
      panelClassName="w-[460px] rounded-card bg-background border border-hair shadow-elevation-4 overflow-hidden"
    >
      <div className="contents">
        {/* Header */}
        <div className="flex items-start gap-3 px-4 py-4">
          <div className="w-9 h-9 rounded-modal flex items-center justify-center bg-role-external/10 border border-role-external/20 flex-shrink-0">
            <Pencil className="w-4 h-4 text-role-external" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 id={TITLE_ID} className="typo-heading text-ink-1 mb-1">{t.triggers.builder.rename_event_type}</h3>
            <p className="typo-caption text-ink-2">
              {t.triggers.builder.rename_event_desc}
            </p>
          </div>
          <Button
            type="button"
            onClick={onCancel}
            variant="ghost"
            size="icon-sm"
            className="flex-shrink-0"
            icon={<X className="w-3.5 h-3.5" />}
          />
        </div>

        {/* Body */}
        <div className="px-4 pb-3 space-y-3">
          <div>
            <label className="block typo-eyebrow text-ink-1 mb-1">
              {t.triggers.builder.current_name}
            </label>
            <div className="px-2.5 py-1.5 rounded-card bg-surface-1 border border-hair typo-code text-ink-1">
              {oldEventType}
            </div>
          </div>

          <div>
            <label
              htmlFor="rename-event-new"
              className="block typo-eyebrow text-ink-1 mb-1"
            >
              {t.triggers.builder.new_name}
            </label>
            <input
              id="rename-event-new"
              type="text"
              value={newEventType}
              onChange={e => setNewEventType(e.target.value)}
              disabled={sourceReserved || busy}
              autoFocus
              onKeyDown={e => {
                if (e.key === 'Enter' && !disabled) {
                  e.preventDefault();
                  void handleConfirm();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  onCancel();
                }
              }}
              className={`w-full px-2.5 py-1.5 typo-code rounded-card bg-surface-1 border text-ink-1 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed ${
                clientError && !sourceReserved
                  ? 'border-status-warning/40 focus:border-status-warning/60'
                  : 'border-hair focus:border-role-external/50'
              }`}
              placeholder={t.triggers.builder.rename_placeholder}
            />
          </div>

          {/* Impact preview */}
          <div className="rounded-card border border-hair bg-surface-1 px-3 py-2">
            <div className="flex items-center gap-1.5 typo-eyebrow text-ink-1 mb-1.5">
              <CheckCircle2 className="w-3 h-3 text-role-external" />
              {t.triggers.builder.impact_preview}
            </div>
            <div className="typo-caption text-ink-2 space-y-0.5">
              <div>
                <span className="text-ink-1">{t.triggers.builder.source_personas}</span>{' '}
                <span className="font-semibold">{affectedCounts.sources}</span>
              </div>
              <div>
                <span className="text-ink-1">{t.triggers.builder.connected_listeners}</span>{' '}
                <span className="font-semibold">{affectedCounts.connections}</span>
              </div>
              <div className="typo-caption text-ink-2 pt-1">
                {t.triggers.rename_also_updates}
              </div>
            </div>
          </div>

          {/* Errors */}
          {(clientError || serverError) && (
            <div className="flex items-start gap-2 rounded-card border border-status-warning/25 bg-status-warning/10 px-3 py-2">
              <AlertTriangle className="w-3.5 h-3.5 text-status-warning flex-shrink-0 mt-0.5" />
              <p className="typo-caption text-status-warning break-words">
                {serverError ? inlineErrorCopy(t, serverError.raw) : clientError}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-hair bg-surface-1">
          <Button type="button" onClick={onCancel} disabled={busy} variant="ghost" size="sm">{t.triggers.builder.cancel}</Button>
          <Button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={disabled}
            variant="accent"
            tone="external"
            size="sm"
          >{busy ? t.triggers.builder.renaming : t.triggers.builder.rename}</Button>
        </div>
      </div>
    </BaseModal>
  );
}
