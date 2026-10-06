// useDrawerData — the drawer's one fetch and its three writes.
//
// Lifted out of `MonitorDrawer` verbatim when the surface grew three readings:
// a variant must not be able to own data, or the three stop being readings of
// the same dossier. The per-review keyed ledger (`busyKeys`) stays here too —
// it is the real write guard, and the drawer-wide `isProcessing` the Monitor
// passes down remains presentational.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { listManualReviewsPage } from '@/api/overview/reviews';
import { listUnreadReports, markReportRead } from '@/api/overview/reports';
import { resolveReviewRow, dispatchReviewRowAction } from '@/lib/decisions/rowWrites';
import { silentCatch, toastCatch } from '@/lib/silentCatch';
import { usePersonaCapabilities } from '@/hooks/personas/usePersonaCapabilities';
import type { ManualReviewStatus } from '@/lib/bindings/ManualReviewStatus';
import type { PersonaReport } from '@/lib/bindings/PersonaReport';
import { shapeReview, type MonitorReviewItem } from '../useMonitorData';
import { SEVERITY_META, severityBucket, type PersonaCardModel } from '../monitorModel';

const PROCESS_ORDER: Record<string, number> = {
  input_required: 0, draft_ready: 1, running: 2, queued: 3,
};

export function useDrawerData(
  card: PersonaCardModel,
  designContext: string | null,
  onAttentionChanged?: () => void | Promise<void>,
) {
  const [reviews, setReviews] = useState<MonitorReviewItem[]>([]);
  const [messages, setMessages] = useState<PersonaReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKeys, setBusyKeys] = useState<readonly string[]>([]);

  // Charters first, design-context use cases only for a persona the e19
  // migration has not reached — the one door, not a second local derivation.
  const { capabilities: useCases } = usePersonaCapabilities(card.personaId, { designContext });

  useEffect(() => {
    let cancelled = false;
    setReviews([]);
    setMessages([]);
    setLoading(true);
    const personaId = card.personaId === 'unassigned' ? '' : card.personaId;
    if (!personaId) {
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }
    Promise.all([
      listManualReviewsPage({ personaId, status: 'pending', limit: 40 }),
      listUnreadReports(personaId, 50),
    ])
      .then(([page, unread]) => {
        if (cancelled) return;
        setReviews(page.rows.map(shapeReview));
        setMessages(unread);
      })
      .catch(silentCatch('MonitorDrawer:personaPage'))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [card.personaId]);

  const isReviewInFlight = useCallback(
    (id: string, intent?: string) =>
      intent === undefined
        ? busyKeys.some((k) => k.startsWith(`review:${id}:`))
        : busyKeys.includes(`review:${id}:${intent}`),
    [busyKeys],
  );

  const track = useCallback((id: string, intent: string, run: () => Promise<void>) => {
    const key = `review:${id}:${intent}`;
    setBusyKeys((prev) => (prev.includes(key) ? prev : [...prev, key]));
    return run().finally(() => {
      setBusyKeys((prev) => prev.filter((k) => k !== key));
    });
  }, []);

  const onReviewAction = useCallback(
    (id: string, status: ManualReviewStatus, notes?: string) =>
      track(id, status, async () => {
        const row = reviews.find((r) => r.id === id);
        if (!row) return;
        try {
          await resolveReviewRow(row, status, notes);
          setReviews((rs) => rs.filter((r) => r.id !== id));
          await onAttentionChanged?.();
        } catch (err) {
          toastCatch('MonitorDrawer:reviewAction')(err);
        }
      }),
    [reviews, track, onAttentionChanged],
  );

  const onDispatchAction = useCallback(
    (id: string, action: string) =>
      track(id, `action:${action}`, async () => {
        const row = reviews.find((r) => r.id === id);
        if (!row) return;
        try {
          await dispatchReviewRowAction(row, action);
          setReviews((rs) => rs.filter((r) => r.id !== id));
          await onAttentionChanged?.();
        } catch (err) {
          toastCatch('MonitorDrawer:dispatchAction')(err);
        }
      }),
    [reviews, track, onAttentionChanged],
  );

  const onMarkRead = useCallback(
    (id: string) => {
      setMessages((ms) => ms.filter((m) => m.id !== id));
      void markReportRead(id)
        .then(() => onAttentionChanged?.())
        .catch((err) => {
          silentCatch('MonitorDrawer:markRead')(err);
          void onAttentionChanged?.();
        });
    },
    [onAttentionChanged],
  );

  const sortedReviews = useMemo(
    () => [...reviews].sort(
      (a, b) => SEVERITY_META[severityBucket(a.severity)].rank - SEVERITY_META[severityBucket(b.severity)].rank,
    ),
    [reviews],
  );
  const sortedMessages = useMemo(
    () => [...messages].sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [messages],
  );
  const sortedProcesses = useMemo(
    () => [...card.processes].sort(
      (a, b) => (PROCESS_ORDER[a.proc.status] ?? 9) - (PROCESS_ORDER[b.proc.status] ?? 9),
    ),
    [card.processes],
  );

  return {
    reviews: sortedReviews,
    messages: sortedMessages,
    processes: sortedProcesses,
    useCases,
    loading,
    isReviewInFlight,
    onReviewAction,
    onDispatchAction,
    onMarkRead,
  };
}
