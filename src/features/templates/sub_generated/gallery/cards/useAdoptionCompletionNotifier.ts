/**
 * Lightweight background poller that detects adoption transform completion
 * when the wizard modal is closed. Fires OS notifications so users know
 * their persona is ready without watching the modal.
 */
import { useEffect, useRef } from 'react';
import { getTemplateAdoptSnapshot } from '@/api/templates/templateAdopt';
import { createLogger } from '@/lib/log';
/** localStorage key for persisted adoption context (legacy wizard) */
const ADOPT_CONTEXT_KEY = 'template-adopt-context-v1';
import { sendOsNotification } from '@/lib/utils/platform/osNotification';
import { silentCatch } from '@/lib/silentCatch';


const logger = createLogger('adoption-notifier');
const POLL_INTERVAL_MS = 5_000;
/** After this many consecutive snapshot fetch failures, clear the localStorage
 *  entry and stop polling — the backend has likely GC'd or restarted and the
 *  adoptId is dead. Without this, the empty catch silently burned CPU on a
 *  dead session indefinitely. */
const MAX_CONSECUTIVE_FAILURES = 5;

export function useAdoptionCompletionNotifier(
  templateAdoptActive: boolean,
  adoptModalOpen: boolean,
) {
  const notifiedRef = useRef<string | null>(null);
  const consecutiveFailuresRef = useRef(0);

  useEffect(() => {
    // Only poll when there's an active adoption AND the modal is closed
    if (!templateAdoptActive || adoptModalOpen) return;

    let cancelled = false;
    consecutiveFailuresRef.current = 0;

    /** Discard the persisted adoption context so:
     *  - a new login session doesn't replay this adoptId for a different user
     *  - terminal notifications don't fire repeatedly for the same adoption
     *  - dead/GC'd backend snapshots stop being polled */
    const clearStoredContext = () => {
      try { window.localStorage.removeItem(ADOPT_CONTEXT_KEY); } catch (err) { silentCatch("features/templates/sub_generated/gallery/cards/useAdoptionCompletionNotifier:catch1")(err); }
    };

    const check = async () => {
      let adoptId: string | undefined;
      let templateName: string | undefined;
      try {
        const raw = window.localStorage.getItem(ADOPT_CONTEXT_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw) as { adoptId?: string; templateName?: string };
        adoptId = parsed.adoptId;
        templateName = parsed.templateName;
      } catch {
        // Malformed localStorage — clear it so we don't keep tripping the parse error.
        clearStoredContext();
        return;
      }
      if (!adoptId || notifiedRef.current === adoptId) return;

      let snapshot;
      try {
        snapshot = await getTemplateAdoptSnapshot(adoptId);
      } catch (err) {
        consecutiveFailuresRef.current++;
        if (consecutiveFailuresRef.current >= MAX_CONSECUTIVE_FAILURES) {
          logger.warn('Adoption snapshot fetch failed repeatedly — clearing stale context', {
            adoptId, failures: consecutiveFailuresRef.current,
            error: err instanceof Error ? err.message : String(err),
          });
          clearStoredContext();
        }
        return;
      }
      if (cancelled) return;
      consecutiveFailuresRef.current = 0;

      const name = templateName || 'Your persona';

      if (snapshot.status === 'completed') {
        notifiedRef.current = adoptId;
        void sendOsNotification('Persona Ready', `${name} has been built. Click to review.`);
        // Terminal state — don't poll this adoption again, even after a session
        // restart. Without clearing, a future session would re-notify.
        clearStoredContext();
      } else if (snapshot.status === 'failed') {
        notifiedRef.current = adoptId;
        void sendOsNotification('Build Failed', `${name} adoption failed. Click to see details.`);
        clearStoredContext();
      } else if (snapshot.status === 'awaiting_answers') {
        notifiedRef.current = adoptId;
        void sendOsNotification('Input Required', `${name} needs your answers to continue.`);
        // 'awaiting_answers' is not terminal — leave the entry so the user
        // returning to the modal can resume.
      }
    };

    void check();
    const interval = setInterval(() => void check(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [templateAdoptActive, adoptModalOpen]);
}
