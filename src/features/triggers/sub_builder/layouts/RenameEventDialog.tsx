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

// Mirrors `RESERVED_EVENT_TYPES` in src-tauri/src/db/repos/resources/triggers.rs.
// Kept in sync manually; the backend still rejects these authoritatively.
const RESERVED_EVENT_TYPES = new Set([
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
  const { t } = useTranslation();
  const [newEventType, setNewEventType] = useState(oldEventType);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  // Reset the input whenever the dialog re-opens on a different row.
  useEffect(() => {
    if (open) {
      setNewEventType(oldEventType);
      setServerError(null);
      setBusy(false);
    }
  }, [open, oldEventType]);

  const clientError = useMemo<string | null>(() => {
    if (reserved) {
      return `\`${oldEventType}\` is a built-in infrastructure event and cannot be renamed.`;
    }
    const trimmed = newEventType.trim();
    if (trimmed.length === 0) return 'New event type cannot be empty.';
    if (trimmed === oldEventType) return 'New name must differ from the current one.';
    if (trimmed.length > 128) return 'Maximum length is 128 characters.';
    if (!isSafeTypeString(trimmed)) {
      return 'Only alphanumeric, underscore, hyphen, dot, colon, and forward-slash are allowed (must start with alphanumeric or underscore).';
    }
    if (RESERVED_EVENT_TYPES.has(trimmed)) {
      return `\`${trimmed}\` is reserved for infrastructure events and can't be used as a target.`;
    }
    return null;
  }, [newEventType, oldEventType, reserved]);

  if (!open) return null;

  const disabled = busy || clientError !== null;

  async function handleConfirm() {
    if (disabled) return;
    setBusy(true);
    setServerError(null);
    try {
      await onConfirm(newEventType.trim());
      // Parent closes the dialog on success.
    } catch (e) {
      setServerError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onCancel}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative w-[460px] rounded-2xl bg-background border border-primary/15 shadow-elevation-4 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start gap-3 px-4 py-4">
          <div className="w-9 h-9 rounded-modal flex items-center justify-center bg-cyan-500/10 border border-cyan-400/20 flex-shrink-0">
            <Pencil className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-foreground mb-1">{t.triggers.builder.rename_event_type}</h3>
            <p className="text-xs text-foreground leading-relaxed">
              {t.triggers.builder.rename_event_desc}
            </p>
          </div>
          <button
            onClick={onCancel}
            className="p-1 rounded-card hover:bg-secondary/60 text-foreground flex-shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-4 pb-3 space-y-3">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-foreground mb-1">
              {t.triggers.builder.current_name}
            </label>
            <div className="px-2.5 py-1.5 rounded-card bg-secondary/30 border border-primary/10 text-sm font-mono text-foreground/90">
              {oldEventType}
            </div>
          </div>

          <div>
            <label
              htmlFor="rename-event-new"
              className="block text-[11px] font-semibold uppercase tracking-wider text-foreground mb-1"
            >
              {t.triggers.builder.new_name}
            </label>
            <input
              id="rename-event-new"
              type="text"
              value={newEventType}
              onChange={e => setNewEventType(e.target.value)}
              disabled={reserved || busy}
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
              className={`w-full px-2.5 py-1.5 text-sm font-mono rounded-card bg-secondary/30 border text-foreground focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed ${
                clientError && !reserved
                  ? 'border-amber-400/40 focus:border-amber-400/60'
                  : 'border-primary/15 focus:border-cyan-400/50'
              }`}
              placeholder={t.triggers.builder.rename_placeholder}
            />
          </div>

          {/* Impact preview */}
          <div className="rounded-card border border-primary/10 bg-secondary/20 px-3 py-2">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-foreground mb-1.5">
              <CheckCircle2 className="w-3 h-3 text-cyan-400/70" />
              {t.triggers.builder.impact_preview}
            </div>
            <div className="text-xs text-foreground space-y-0.5">
              <div>
                <span className="text-foreground">{t.triggers.builder.source_personas}</span>{' '}
                <span className="font-semibold">{affectedCounts.sources}</span>
              </div>
              <div>
                <span className="text-foreground">{t.triggers.builder.connected_listeners}</span>{' '}
                <span className="font-semibold">{affectedCounts.connections}</span>
              </div>
              <div className="text-[10px] text-foreground pt-1">
                Also updates historical events, persona event handlers, and trigger audit metadata.
              </div>
            </div>
          </div>

          {/* Errors */}
          {(clientError || serverError) && (
            <div className="flex items-start gap-2 rounded-card border border-amber-400/25 bg-amber-500/10 px-3 py-2">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-amber-300/90 leading-relaxed break-words">
                {serverError ?? clientError}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-primary/10 bg-secondary/20">
          <button
            onClick={onCancel}
            disabled={busy}
            className="px-3 py-1.5 rounded-card text-xs font-medium text-foreground hover:text-foreground hover:bg-secondary/60 transition-colors disabled:opacity-50"
          >
            {t.triggers.builder.cancel}
          </button>
          <button
            onClick={() => void handleConfirm()}
            disabled={disabled}
            className="px-3 py-1.5 rounded-card text-xs font-medium bg-cyan-500/15 text-cyan-400 hover:bg-cyan-500/25 border border-cyan-400/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busy ? t.triggers.builder.renaming : t.triggers.builder.rename}
          </button>
        </div>
      </div>
    </div>
  );
}
