import { useState, useCallback } from 'react';
import { rebuildDesignReview, getRebuildSnapshot, cancelRebuild } from '@/api/reviews';
import { sendAppNotification } from '@/api/system';
import { useBackgroundSnapshot } from '@/hooks/utility/useBackgroundSnapshot';
import type { SnapshotLike } from '@/hooks/utility/useBackgroundSnapshot';
import { usePersonaStore } from '@/stores/personaStore';

export type RebuildPhase = 'idle' | 'input' | 'processing' | 'completed' | 'failed';

export interface BackgroundRebuildState {
  rebuildId: string | null;
  phase: RebuildPhase;
  lines: string[];
  error: string | null;
  reviewId: string | null;
  reviewName: string | null;
}

export interface UseBackgroundRebuildReturn extends BackgroundRebuildState {
  startRebuild: (reviewId: string, reviewName: string, userDirection?: string) => Promise<void>;
  cancelCurrentRebuild: () => Promise<void>;
  resetRebuild: () => void;
  isActive: boolean;
}

export function useBackgroundRebuild(onCompleted?: () => void): UseBackgroundRebuildReturn {
  const [rebuildId, setRebuildId] = useState<string | null>(null);
  const [phase, setPhase] = useState<RebuildPhase>('idle');
  const [lines, setLines] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [reviewName, setReviewName] = useState<string | null>(null);

  const setRebuildActive = usePersonaStore((s) => s.setRebuildActive);

  const getSnapshot = useCallback(
    async (id: string): Promise<SnapshotLike> => {
      const snap = await getRebuildSnapshot(id);
      return {
        status: snap.status,
        error: snap.error,
        lines: snap.lines,
        draft: null,
        questions: null,
      };
    },
    [],
  );

  const handleLines = useCallback((newLines: string[]) => {
    setLines(newLines);
  }, []);

  const handlePhase = useCallback((p: 'running' | 'completed' | 'failed') => {
    if (p === 'completed') {
      setPhase('completed');
      setRebuildActive(false);
      sendAppNotification('Rebuild Complete', 'Template rebuild finished successfully.').catch(() => {});
      onCompleted?.();
    } else if (p === 'failed') {
      setPhase('failed');
      setRebuildActive(false);
    }
  }, [setRebuildActive, onCompleted]);

  const handleFailed = useCallback((err: string) => {
    setError(err);
    setPhase('failed');
    setRebuildActive(false);
    sendAppNotification('Rebuild Failed', 'Template rebuild encountered an error.').catch(() => {});
  }, [setRebuildActive]);

  const handleCompletedNoDraft = useCallback(() => {
    setPhase('completed');
    setRebuildActive(false);
    sendAppNotification('Rebuild Complete', 'Template rebuild finished successfully.').catch(() => {});
    onCompleted?.();
  }, [setRebuildActive, onCompleted]);

  const handleSessionLost = useCallback(() => {
    setError('Connection lost — the rebuild may still be running in the background.');
    setPhase('failed');
    setRebuildActive(false);
  }, [setRebuildActive]);

  const handleDraft = useCallback(() => {
    setPhase('completed');
    setRebuildActive(false);
    sendAppNotification('Rebuild Complete', 'Template rebuild finished successfully.').catch(() => {});
    onCompleted?.();
  }, [setRebuildActive, onCompleted]);

  useBackgroundSnapshot({
    snapshotId: rebuildId,
    getSnapshot,
    onLines: handleLines,
    onPhase: handlePhase,
    onDraft: handleDraft,
    onCompletedNoDraft: handleCompletedNoDraft,
    onFailed: handleFailed,
    onSessionLost: handleSessionLost,
    interval: 1500,
  });

  const startRebuild = useCallback(async (rId: string, rName: string, userDirection?: string) => {
    setPhase('processing');
    setLines([]);
    setError(null);
    setReviewId(rId);
    setReviewName(rName);
    setRebuildActive(true);
    try {
      const result = await rebuildDesignReview(rId, userDirection?.trim() || undefined);
      setRebuildId(result.rebuild_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('failed');
      setRebuildActive(false);
    }
  }, [setRebuildActive]);

  const cancelCurrentRebuild = useCallback(async () => {
    if (rebuildId) {
      try {
        await cancelRebuild(rebuildId);
      } catch {
        // Best effort
      }
    }
    setPhase('failed');
    setError('Cancelled by user');
    setRebuildActive(false);
  }, [rebuildId, setRebuildActive]);

  const resetRebuild = useCallback(() => {
    setRebuildId(null);
    setPhase('idle');
    setLines([]);
    setError(null);
    setReviewId(null);
    setReviewName(null);
    setRebuildActive(false);
  }, [setRebuildActive]);

  return {
    rebuildId,
    phase,
    lines,
    error,
    reviewId,
    reviewName,
    startRebuild,
    cancelCurrentRebuild,
    resetRebuild,
    isActive: phase === 'processing',
  };
}
