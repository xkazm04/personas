import { useCallback, useEffect, useState } from 'react';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { EventName, typedListen } from '@/lib/eventRegistry';
import { useSystemStore } from '@/stores/systemStore';
import { silentCatch } from '@/lib/silentCatch';
import {
  obsidianRevitalizeActive,
  obsidianRevitalizeCancel,
  obsidianRevitalizeSnapshot,
  obsidianRevitalizeStart,
  type RevitalizeOptions,
  type RevitalizeSummary,
} from '@/api/obsidianBrain';

/** Keep the visible log bounded; the backend caps stored lines at 500 anyway. */
const MAX_VISIBLE_LINES = 200;

/**
 * Lifecycle of one revitalize pass, panel-side.
 *
 * Global run/complete flags live in the store (fed by the eventBridge
 * status listener so sidebar dots survive navigation); this hook owns the
 * panel-local stream: output lines, the final summary, errors, and
 * re-attaching to a pass that was started before the panel mounted.
 */
export function useRevitalizeJob() {
  const jobId = useSystemStore((s) => s.obsidianRevitalizeJobId);
  const running = useSystemStore((s) => s.obsidianRevitalizeRunning);
  const registerStart = useSystemStore((s) => s.startObsidianRevitalize);
  const clearCompletion = useSystemStore((s) => s.clearObsidianRevitalizeCompletion);

  const [lines, setLines] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<RevitalizeSummary | null>(null);

  // Re-attach on mount: if a pass is running (or just finished) that this
  // panel instance hasn't seen, seed lines/summary from the snapshot.
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const active = useSystemStore.getState().obsidianRevitalizeJobId
          ?? (await obsidianRevitalizeActive());
        if (!active || !alive) return;
        const snap = await obsidianRevitalizeSnapshot(active);
        if (!alive) return;
        if (snap.status === 'running' && !useSystemStore.getState().obsidianRevitalizeJobId) {
          registerStart(active);
        }
        setLines(snap.lines.slice(-MAX_VISIBLE_LINES));
        setSummary(snap.summary);
        if (snap.status === 'failed' && snap.error) setError(snap.error);
      } catch (err) {
        // Job evicted or none active — nothing to re-attach to.
        silentCatch('obsidian-brain/useRevitalizeJob:reattach')(err);
      }
    })();
    return () => {
      alive = false;
    };
    // Mount-only: subsequent jobs flow through start().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stream output + terminal status for the tracked job.
  useEffect(() => {
    if (!jobId) return;
    const unsubs: UnlistenFn[] = [];
    let alive = true;
    void typedListen(EventName.OBSIDIAN_REVITALIZE_OUTPUT, (p) => {
      if (p.job_id !== jobId) return;
      setLines((prev) => [...prev.slice(-(MAX_VISIBLE_LINES - 1)), p.line]);
    }).then((u) => (alive ? unsubs.push(u) : u()));
    void typedListen(EventName.OBSIDIAN_REVITALIZE_STATUS, (p) => {
      if (p.job_id !== jobId) return;
      if (p.status === 'failed') {
        setError(p.error ?? 'Revitalization failed');
      } else if (p.status === 'completed') {
        // Summary is attached to the snapshot, not the status event.
        obsidianRevitalizeSnapshot(jobId)
          .then((snap) => setSummary(snap.summary))
          .catch(silentCatch('obsidian-brain/useRevitalizeJob:summary'));
      }
    }).then((u) => (alive ? unsubs.push(u) : u()));
    return () => {
      alive = false;
      unsubs.forEach((u) => u());
    };
  }, [jobId]);

  const start = useCallback(
    async (options: RevitalizeOptions) => {
      setLines([]);
      setError(null);
      setSummary(null);
      clearCompletion();
      const id = await obsidianRevitalizeStart(options);
      registerStart(id);
    },
    [clearCompletion, registerStart],
  );

  const cancel = useCallback(async () => {
    const id = useSystemStore.getState().obsidianRevitalizeJobId;
    if (!id) return;
    await obsidianRevitalizeCancel(id);
  }, []);

  const dismissSummary = useCallback(() => {
    setSummary(null);
    setError(null);
    clearCompletion();
  }, [clearCompletion]);

  return { running, lines, error, summary, start, cancel, dismissSummary };
}
