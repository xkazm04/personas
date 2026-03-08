/**
 * Lightweight background poller that detects adoption transform completion
 * when the wizard modal is closed. Fires OS notifications so users know
 * their persona is ready without watching the modal.
 */
import { useEffect, useRef } from 'react';
import { getTemplateAdoptSnapshot } from '@/api/templateAdopt';
import { ADOPT_CONTEXT_KEY } from '../adoption/useAdoptReducer';
import { sendOsNotification } from '@/lib/utils/osNotification';

const POLL_INTERVAL_MS = 5_000;

export function useAdoptionCompletionNotifier(
  templateAdoptActive: boolean,
  adoptModalOpen: boolean,
) {
  const notifiedRef = useRef<string | null>(null);

  useEffect(() => {
    // Only poll when there's an active adoption AND the modal is closed
    if (!templateAdoptActive || adoptModalOpen) return;

    let cancelled = false;

    const check = async () => {
      try {
        const raw = window.localStorage.getItem(ADOPT_CONTEXT_KEY);
        if (!raw) return;
        const { adoptId, templateName } = JSON.parse(raw) as {
          adoptId: string;
          templateName?: string;
        };
        if (!adoptId || notifiedRef.current === adoptId) return;

        const snapshot = await getTemplateAdoptSnapshot(adoptId);
        if (cancelled) return;

        const name = templateName || 'Your persona';

        if (snapshot.status === 'completed') {
          notifiedRef.current = adoptId;
          void sendOsNotification('Persona Ready', `${name} has been built. Click to review.`);
        } else if (snapshot.status === 'failed') {
          notifiedRef.current = adoptId;
          void sendOsNotification('Build Failed', `${name} adoption failed. Click to see details.`);
        } else if (snapshot.status === 'awaiting_answers') {
          notifiedRef.current = adoptId;
          void sendOsNotification('Input Required', `${name} needs your answers to continue.`);
        }
      } catch {
        /* intentional: non-critical — polling failure */
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
