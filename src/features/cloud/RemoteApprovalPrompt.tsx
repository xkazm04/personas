import { useCallback, useEffect } from 'react';
import { BaseModal } from '@/lib/ui/BaseModal';
import Button from '@/features/shared/components/buttons/Button';
import { useAuthStore } from '@/stores/authStore';
import { useRemoteCommandStore } from '@/stores/remoteCommandStore';
import { useTauriEvent } from '@/hooks/useTauriEvent';
import { useTranslation, interpolate } from '@/i18n/useTranslation';
import type { RemoteCommand } from '@/lib/bindings/RemoteCommand';

/**
 * Phase 2 approval gate. Surfaces run-requests the web dashboard sent to this
 * device and requires an explicit Approve/Reject. Nothing runs without the
 * user's click; the persona then runs locally with its own credentials.
 * Mounted once at the app root.
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
      <div className="p-6 space-y-4">
        <h2 id="remote-approval-title" className="typo-body-lg font-semibold text-foreground">
          {s.title}
        </h2>
        <p className="typo-body text-foreground/80">
          {interpolate(s.body, { persona: personaLabel })}
        </p>
        {current.prompt && (
          <div className="rounded-card bg-secondary/30 border border-primary/10 p-3 max-h-40 overflow-y-auto">
            <p className="typo-caption whitespace-pre-wrap text-foreground/90">{current.prompt}</p>
          </div>
        )}
        <p className="typo-caption text-foreground/60">{s.safety_note}</p>
        <div className="flex items-center justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={() => { void reject(current.id); }} disabled={busy}>
            {s.reject}
          </Button>
          <Button variant="primary" onClick={() => { void approve(current.id); }} disabled={busy}>
            {busy ? s.approving : s.approve}
          </Button>
        </div>
      </div>
    </BaseModal>
  );
}
