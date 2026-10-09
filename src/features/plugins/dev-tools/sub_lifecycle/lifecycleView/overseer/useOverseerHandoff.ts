// The Lifecycle header's hand-off to the Overseer, as state: the watch (what
// `setLifecycleWatch` RETURNED, seeded from the snapshot and re-synced when it
// changes; never optimistic), the Send preview (the backend's dry run, read
// each time the confirm opens), the send itself and what it came to.
//
// A reply that lands after the picker moved on belongs to the old project and
// is dropped. A send failure closes the confirm and is said in the header's
// inline Banner; a preview failure is said inside the confirm, which can still
// send (the preview explains the send, it does not gate it).
import { useEffect, useRef, useState } from 'react';

import { previewLifecycleSend, sendLifecycleToOverseer, setLifecycleWatch } from '@/api/devTools/lifecycle';
import type { LifecycleSendPreview } from '@/lib/bindings/LifecycleSendPreview';
import type { LifecycleSendResult } from '@/lib/bindings/LifecycleSendResult';
import { resolveError } from '@/lib/errors/errorRegistry';
import { extractMessage, silentCatch } from '@/lib/silentCatch';

export type PreviewState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; preview: LifecycleSendPreview };

export interface OverseerHandoff {
  watched: boolean;
  starBusy: boolean;
  toggleWatch: () => Promise<void>;
  /** The confirm is open. */
  confirming: boolean;
  preview: PreviewState;
  openConfirm: () => void;
  closeConfirm: () => void;
  /** Confirmed: send, then close the confirm. */
  send: () => Promise<void>;
  result: LifecycleSendResult | null;
  error: string | null;
  dismissError: () => void;
}

const message = (err: unknown) => resolveError(extractMessage(err)).message;

export function useOverseerHandoff(projectId: string | null, watchedNow: boolean): OverseerHandoff {
  const [watched, setWatched] = useState(watchedNow);
  const [starBusy, setStarBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [preview, setPreview] = useState<PreviewState>({ phase: 'loading' });
  const [result, setResult] = useState<LifecycleSendResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const current = useRef(projectId);
  useEffect(() => {
    current.current = projectId;
    setResult(null);
    setError(null);
    setConfirming(false);
  }, [projectId]);
  useEffect(() => setWatched(watchedNow), [watchedNow, projectId]);

  const mine = (forProject: string) => current.current === forProject;

  const toggleWatch = async () => {
    if (!projectId) return;
    const forProject = projectId;
    setStarBusy(true);
    setError(null);
    try {
      const next = await setLifecycleWatch(forProject, !watched);
      if (mine(forProject)) setWatched(next);
    } catch (err) {
      silentCatch('lifecycle:set_watch')(err);
      if (mine(forProject)) setError(message(err));
    } finally {
      setStarBusy(false);
    }
  };

  const openConfirm = () => {
    if (!projectId) return;
    const forProject = projectId;
    setError(null);
    setPreview({ phase: 'loading' });
    setConfirming(true);
    previewLifecycleSend(forProject)
      .then((p) => { if (mine(forProject)) setPreview({ phase: 'ready', preview: p }); })
      .catch((err: unknown) => {
        silentCatch('lifecycle:send_preview')(err);
        if (mine(forProject)) setPreview({ phase: 'error', message: message(err) });
      });
  };

  const send = async () => {
    if (!projectId) return;
    const forProject = projectId;
    setError(null);
    setResult(null);
    try {
      const sent = await sendLifecycleToOverseer(forProject);
      if (mine(forProject)) {
        setResult(sent);
        // A send also puts the project on his watch list.
        setWatched(true);
      }
    } catch (err) {
      silentCatch('lifecycle:send_to_overseer')(err);
      if (mine(forProject)) setError(message(err));
    } finally {
      if (mine(forProject)) setConfirming(false);
    }
  };

  return {
    watched, starBusy, toggleWatch,
    confirming, preview, openConfirm, closeConfirm: () => setConfirming(false), send,
    result, error, dismissError: () => setError(null),
  };
}
