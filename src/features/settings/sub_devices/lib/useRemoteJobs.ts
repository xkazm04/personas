/**
 * Wires the remote-job history to the store, the IPC reads and the row
 * selection. Everything decision-shaped (how a pushed row merges, ordering,
 * the cap) lives in `@/lib/network/remoteJobHistory`; this hook is plumbing.
 *
 * The direction filter is applied CLIENT-side against the one full fetch. That
 * is deliberate: re-fetching per filter would empty the table for a frame each
 * time the operator flips it, and the loading contract says a refetch must
 * never blank rows that are already on screen.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSystemStore } from '@/stores/systemStore';
import { createLogger } from '@/lib/log';
import type { RemoteJobNote } from '@/lib/bindings/RemoteJobNote';
import {
  selectJobsForDirection,
  type RemoteJobDirectionFilter,
} from '@/lib/network/remoteJobHistory';

const logger = createLogger('remote-jobs');

export function useRemoteJobs() {
  const jobs = useSystemStore((s) => s.remoteJobs);
  const isLoading = useSystemStore((s) => s.remoteJobsLoading);
  const synced = useSystemStore((s) => s.remoteJobsSynced);
  const fetchRemoteJobs = useSystemStore((s) => s.fetchRemoteJobs);
  const fetchRemoteJobNotes = useSystemStore((s) => s.fetchRemoteJobNotes);

  const [direction, setDirection] = useState<RemoteJobDirectionFilter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notes, setNotes] = useState<RemoteJobNote[]>([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [notesError, setNotesError] = useState(false);

  useEffect(() => {
    void fetchRemoteJobs();
  }, [fetchRemoteJobs]);

  const visibleJobs = useMemo(
    () => selectJobsForDirection(jobs, direction),
    [jobs, direction],
  );

  const selectedJob = useMemo(
    () => jobs.find((job) => job.id === selectedId) ?? null,
    [jobs, selectedId],
  );

  // Re-read the notes whenever the selected job advances. `lastSeq` is the
  // highest progress note either side has durably handled, so it changes
  // exactly when there is a new note to fetch — a far tighter trigger than
  // `updatedAt`, which also moves on status-only transitions.
  const selectedSeq = selectedJob?.lastSeq ?? 0;
  const selectedStatus = selectedJob?.status ?? null;

  useEffect(() => {
    if (!selectedId) {
      setNotes([]);
      setNotesError(false);
      return;
    }
    let cancelled = false;
    setNotesLoading(true);
    setNotesError(false);

    const load = async () => {
      try {
        const rows = await fetchRemoteJobNotes(selectedId);
        if (cancelled) return;
        setNotes(rows);
        setNotesLoading(false);
      } catch (err) {
        if (cancelled) return;
        // Shown in place by `RemoteJobDetail`, so this only needs a breadcrumb.
        logger.warn('Failed to load remote job notes', { jobId: selectedId, error: err });
        setNotesError(true);
        setNotesLoading(false);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
    // `selectedSeq` / `selectedStatus` are the freshness triggers, not inputs.
  }, [selectedId, selectedSeq, selectedStatus, fetchRemoteJobNotes]);

  const toggleSelected = useCallback((jobId: string) => {
    setSelectedId((current) => (current === jobId ? null : jobId));
  }, []);

  return {
    jobs: visibleJobs,
    /** True only while the FIRST fetch is in flight — a refetch keeps rows. */
    isLoading: isLoading && !synced,
    direction,
    setDirection,
    selectedJob,
    selectedId,
    toggleSelected,
    clearSelected: useCallback(() => setSelectedId(null), []),
    notes,
    notesLoading,
    notesError,
  };
}
