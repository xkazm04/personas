import { useCallback, useEffect } from 'react';
import { CloudDownload, Play, ShieldCheck } from 'lucide-react';
import { BaseModal } from '@/lib/ui/BaseModal';
import Button from '@/features/shared/components/buttons/Button';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useAuthStore } from '@/stores/authStore';
import { useRemoteCommandStore } from '@/stores/remoteCommandStore';
import { useTauriEvent } from '@/hooks/useTauriEvent';
import { useTranslation, interpolate } from '@/i18n/useTranslation';
import type { RemoteCommand } from '@/lib/bindings/RemoteCommand';

/** First letter of the persona label, for the glyph. */
function initial(label: string): string {
  return (label.trim()[0] ?? '?').toUpperCase();
}

/**
 * Phase 2 approval gate (v2). Surfaces run-requests the web dashboard sent to
 * this device and requires an explicit Approve/Reject — nothing runs without
 * the user's click; the persona then runs locally with its own credentials.
 * Shows a queue indicator when multiple requests are pending. Mounted once at
 * the app root.
 */
export default function RemoteApprovalPrompt() {
  const { t } = useTranslation();
  const s = t.remote_approval;
  const isAuthenticated = useAuthStore((st) => st.isAuthenticated);
  const queue = useRemoteCommandStore((st) => st.queue);
  const busyId = useRemoteCommandStore((st) => st.busyId);
  const loadPending = useRemoteCommandStore((st) => st.loadPending);
  const enqueue = useRemoteCommandStore((st) => st.enqueue);
  const approve = useRemoteCommandStore((st) => st.approve);
  const reject = useRemoteCommandStore((st) => st.reject);
  const dismiss = useRemoteCommandStore((st) => st.dismiss);

  // Catch requests that arrived while the app was closed / before this mounted.
  useEffect(() => {
    if (isAuthenticated) void loadPending();
  }, [isAuthenticated, loadPending]);

  const onPending = useCallback(
    (e: { payload: RemoteCommand }) => enqueue(e.payload),
    [enqueue],
  );
  useTauriEvent<RemoteCommand>('remote-command-pending', onPending);

  const current = queue[0];
  if (!isAuthenticated || !current) return null;

  const busy = busyId === current.id;
  const personaLabel = current.personaName ?? current.personaId;

  return (
    <BaseModal
      isOpen
      onClose={() => dismiss(current.id)}
      titleId="remote-approval-title"
      size="sm"
      portal
    >
      <div className="p-6 space-y-5">
        {/* Header: queue position + provenance */}
        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-1.5 typo-caption font-medium text-sky-300/90">
            <CloudDownload className="w-3.5 h-3.5" />
            {s.from_dashboard}
          </span>
          {queue.length > 1 && (
            <span className="rounded-full bg-secondary/40 border border-primary/10 px-2 py-0.5 typo-caption font-medium text-foreground/70">
              {interpolate(s.queue_count, { index: 1, total: queue.length })}
            </span>
          )}
        </div>

        {/* Persona identity */}
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-full bg-primary/15 border border-primary/20 flex items-center justify-center flex-shrink-0">
            <span className="typo-body-lg font-semibold text-primary">{initial(personaLabel)}</span>
          </div>
          <div className="min-w-0">
            <h2 id="remote-approval-title" className="typo-body-lg font-semibold text-foreground truncate">
              {personaLabel}
            </h2>
            <p className="typo-caption text-foreground/55">
              <RelativeTime timestamp={current.requestedAt} />
            </p>
          </div>
        </div>

        <p className="typo-body text-foreground/80">
          {interpolate(s.body, { persona: personaLabel })}
        </p>

        {/* Prompt detail */}
        <div className="space-y-1.5">
          <p className="typo-caption font-medium text-foreground/55 uppercase tracking-wide">
            {s.prompt_label}
          </p>
          <div className="rounded-card bg-secondary/30 border border-primary/10 p-3 max-h-40 overflow-y-auto">
            <p className="typo-caption whitespace-pre-wrap text-foreground/90">
              {current.prompt?.trim() || s.no_prompt}
            </p>
          </div>
        </div>

        {/* Safety framing */}
        <div className="flex items-start gap-2 rounded-card border border-emerald-500/15 bg-emerald-500/5 p-3">
          <ShieldCheck className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" />
          <p className="typo-caption text-foreground/70">{s.safety_note}</p>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 pt-1">
          <Button variant="ghost" onClick={() => dismiss(current.id)} disabled={busy}>
            {s.later}
          </Button>
          <Button variant="secondary" onClick={() => { void reject(current.id); }} disabled={busy}>
            {s.reject}
          </Button>
          <Button
            variant="primary"
            icon={<Play className="w-4 h-4" />}
            onClick={() => { void approve(current.id); }}
            disabled={busy}
          >
            {busy ? s.approving : s.approve}
          </Button>
        </div>
      </div>
    </BaseModal>
  );
}
