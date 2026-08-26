// Prototype shell for the two ledger directions.
//
// Owns everything that is NOT the row treatment — data, filters, actions,
// deep-link, keyboard triage, the detail modal, the last-seen marker and the
// autonomous-log toggle — and hands the chosen variant a flat incident list.
// Grouping is gone by construction: the shell never groups, so both variants
// are plain ledgers with their own sort + pagination.
//
// Prototype-local copy (COPY) — extracted to i18n at consolidation.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, Inbox } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { tokenLabel } from '@/i18n/tokenMaps';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import EmptyState, { InboxZero } from '@/features/shared/components/feedback/ScenarioEmptyState';
import { InlineErrorBanner } from '@/features/shared/components/feedback/InlineErrorBanner';
import { ListSkeleton } from '@/features/shared/components/layout/ListSkeleton';
import { storeBus } from '@/lib/storeBus';
import { silentCatch } from '@/lib/silentCatch';
import { getAuditIncident } from '@/api/overview/incidents';
import { useIncidentsData, DEFAULT_LIMIT } from '../libs/useIncidentsData';
import { useIncidentActions } from '../libs/useIncidentActions';
import { useAutonomousIncidents } from '../libs/useAutonomousIncidents';
import { consumePendingIncidentDeepLink } from '../libs/incidentDeepLink';
import { IncidentsInboxKpiHeader } from './IncidentsInboxKpiHeader';
import { IncidentsFilterBar } from './IncidentsFilterBar';
import { IncidentDetailModal } from './IncidentDetailModal';
import { IncidentsLedgerView } from './ledger/IncidentsLedgerView';
import { IncidentsConsoleView } from './ledger/IncidentsConsoleView';
import { AutonomousLogTable } from './autonomous/AutonomousLogTable';
import { AutonomousLogTrail } from './autonomous/AutonomousLogTrail';
import type { IncidentFilters } from '@/lib/bindings/IncidentFilters';
import type { AuditIncident } from '@/lib/bindings/AuditIncident';
import { OPEN_ONLY_FILTERS as DEFAULT_FILTERS, isNarrowedFilters } from '../libs/incidentFilterDefaults';

const FILTERS_KEY = 'incidents:filters';
const LAST_SEEN_KEY = 'incidents:last-seen';

const COPY = {
  backToInbox: 'Back to inbox',
};

export type InboxVariant = 'ledger' | 'console';
export type AutonomousVariant = 'table' | 'trail';

/** Restore only the stable filter dimensions — see the baseline's note. */
function loadPersistedFilters(): IncidentFilters {
  try {
    const raw = localStorage.getItem(FILTERS_KEY);
    if (!raw) return DEFAULT_FILTERS;
    const saved = JSON.parse(raw) as Partial<IncidentFilters>;
    return {
      statuses: saved.statuses ?? DEFAULT_FILTERS.statuses,
      severities: saved.severities ?? null,
      source_tables: saved.source_tables ?? null,
      persona_id: null,
      since: null,
    };
  } catch {
    return DEFAULT_FILTERS;
  }
}

export function IncidentsInboxShell({
  variant,
  autonomousVariant,
}: {
  variant: InboxVariant;
  autonomousVariant: AutonomousVariant;
}) {
  const { t } = useTranslation();
  const [filters, setFilters] = useState<IncidentFilters>(loadPersistedFilters);
  const [detailIncident, setDetailIncident] = useState<AuditIncident | null>(null);
  const [justCleared, setJustCleared] = useState(false);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [showAutonomous, setShowAutonomous] = useState(false);
  // Read once on mount and never updated in-session: the marker is stamped on
  // unmount, so "new since your last visit" stays stable while you triage
  // instead of quietly re-baselining under the rows you are reading.
  const [lastSeenAt] = useState<string | null>(() => {
    try { return localStorage.getItem(LAST_SEEN_KEY); } catch { return null; }
  });
  const clearedByActionRef = useRef(false);

  const { incidents, summary, loading, error, refresh, truncated } = useIncidentsData(filters);
  const autonomous = useAutonomousIncidents();

  const onAfterChange = useCallback(async () => {
    clearedByActionRef.current = true;
    await refresh();
  }, [refresh]);
  const actions = useIncidentActions({ onAfterChange });

  const incidentsRef = useRef<AuditIncident[]>(incidents);
  incidentsRef.current = incidents;

  // Deep-link (Athena's incident_blocker nudge) — latch on mount + subscribe.
  useEffect(() => {
    let cancelled = false;
    const openById = (incidentId: string) => {
      const fromList = incidentsRef.current.find((i) => i.id === incidentId);
      if (fromList) {
        if (!cancelled) setDetailIncident(fromList);
        return;
      }
      getAuditIncident(incidentId)
        .then((incident) => { if (!cancelled && incident) setDetailIncident(incident); })
        .catch(silentCatch('incidents.deep-link.get_audit_incident'));
    };
    const pending = consumePendingIncidentDeepLink();
    if (pending) openById(pending);
    const unsubscribe = storeBus.on('incidents:open-detail', ({ incidentId }) => openById(incidentId));
    return () => { cancelled = true; unsubscribe(); };
  }, []);

  useEffect(() => {
    try {
      const { statuses, severities, source_tables } = filters;
      localStorage.setItem(FILTERS_KEY, JSON.stringify({ statuses, severities, source_tables }));
    } catch (e) {
      silentCatch('incidents.filters.persist')(e);
    }
  }, [filters]);

  // Stamp "seen" on leaving so the next visit marks only what arrived while away.
  useEffect(() => {
    return () => {
      try { localStorage.setItem(LAST_SEEN_KEY, new Date().toISOString()); }
      catch (e) { silentCatch('incidents.last-seen.persist')(e); }
    };
  }, []);

  // The variant reports the rows it is actually showing (its current page, in
  // its sort order) — keyboard triage then walks exactly what is on screen.
  const [pageRows, setPageRows] = useState<AuditIncident[]>([]);
  const onPageRowsChange = useCallback((rows: AuditIncident[]) => setPageRows(rows), []);

  const visibleRef = useRef(pageRows);
  visibleRef.current = pageRows;
  const focusedIdRef = useRef(focusedId);
  focusedIdRef.current = focusedId;
  const modalOpenRef = useRef(false);
  modalOpenRef.current = detailIncident !== null;
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  const tRef = useRef(t);
  tRef.current = t;
  const autonomousOpenRef = useRef(showAutonomous);
  autonomousOpenRef.current = showAutonomous;

  // Keyboard triage: j/k move, Enter opens, A/R act, Esc clears.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (modalOpenRef.current || autonomousOpenRef.current) return;
      const tgt = e.target as HTMLElement | null;
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.tagName === 'SELECT' || tgt.isContentEditable)) return;
      const list = visibleRef.current;
      if (list.length === 0) return;
      const curIdx = list.findIndex((i) => i.id === focusedIdRef.current);
      const focusAt = (idx: number) => {
        const inc = list[idx];
        if (!inc) return;
        setFocusedId(inc.id);
        document.getElementById(`incident-row-${inc.id}`)?.scrollIntoView({ block: 'nearest' });
        const tt = tRef.current;
        const sev = tokenLabel(tt, 'severity', inc.severity);
        const pos = tt.overview.incidents.a11y_position
          .replace('{current}', String(idx + 1))
          .replace('{total}', String(list.length));
        setAnnouncement(`${sev}, ${inc.title}${inc.personaName ? `, ${inc.personaName}` : ''}. ${pos}`);
      };
      switch (e.key) {
        case 'j':
        case 'ArrowDown':
          e.preventDefault();
          focusAt(curIdx < 0 ? 0 : Math.min(list.length - 1, curIdx + 1));
          break;
        case 'k':
        case 'ArrowUp':
          e.preventDefault();
          focusAt(curIdx < 0 ? list.length - 1 : Math.max(0, curIdx - 1));
          break;
        case 'Enter':
          if (curIdx >= 0) { e.preventDefault(); setDetailIncident(list[curIdx]!); }
          break;
        case 'a':
          if (curIdx >= 0 && list[curIdx]!.status === 'open') {
            e.preventDefault();
            const inc = list[curIdx]!;
            void actionsRef.current.acknowledge(inc.id);
            setAnnouncement(`${tRef.current.overview.incidents.a11y_acknowledged}: ${inc.title}`);
          }
          break;
        case 'r':
          if (curIdx >= 0 && ['open', 'acknowledged', 'in_progress'].includes(list[curIdx]!.status)) {
            e.preventDefault();
            const inc = list[curIdx]!;
            void actionsRef.current.resolve(inc.id).then((ok) => {
              if (ok) setAnnouncement(`${tRef.current.overview.incidents.a11y_resolved}: ${inc.title}`);
            });
          }
          break;
        case 'Escape':
          setFocusedId(null);
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const { acknowledge, resolve, dismiss, reopen } = actions;
  const handleAcknowledge = useCallback((id: string) => void acknowledge(id), [acknowledge]);
  const handleResolve = useCallback((id: string) => void resolve(id), [resolve]);
  const handleDismiss = useCallback((id: string) => void dismiss(id), [dismiss]);
  const handleReopen = useCallback((id: string) => void reopen(id), [reopen]);
  const openDetail = useCallback((incident: AuditIncident) => setDetailIncident(incident), []);
  const toggleAutonomous = useCallback(() => setShowAutonomous((v) => !v), []);

  const isNarrowed = isNarrowedFilters(filters);
  const isInitialLoading = loading && incidents.length === 0;

  useEffect(() => {
    if (loading) return;
    if (incidents.length > 0) {
      setJustCleared(false);
      clearedByActionRef.current = false;
      return;
    }
    if (clearedByActionRef.current && !isNarrowed) setJustCleared(true);
    clearedByActionRef.current = false;
  }, [loading, incidents.length, isNarrowed]);

  const ledgerProps = useMemo(() => ({
    incidents,
    focusedId,
    lastSeenAt,
    onOpenDetail: openDetail,
    onAcknowledge: handleAcknowledge,
    onResolve: handleResolve,
    onDismiss: handleDismiss,
    onReopen: handleReopen,
    onPageRowsChange,
  }), [incidents, focusedId, lastSeenAt, openDetail, handleAcknowledge, handleResolve, handleDismiss, handleReopen, onPageRowsChange]);

  return (
    <ContentBox data-testid="incidents-inbox">
      <ContentHeader
        icon={<Inbox className="w-5 h-5 text-amber-400" />}
        iconColor="amber"
        title={t.overview.incidents.title}
        subtitle={t.overview.incidents.subtitle}
        actions={
          <button
            type="button"
            onClick={() => { void refresh(); void autonomous.refresh(); }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 typo-caption rounded-card border border-primary/15 text-foreground hover:bg-secondary/40 transition-colors focus-ring"
            aria-label={t.overview.incidents.refresh}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            {t.overview.incidents.refresh}
          </button>
        }
      />

      <ContentBody>
        <div aria-live="polite" aria-atomic="true" className="sr-only">{announcement}</div>

        <div className="px-4 pt-3 pb-2">
          <IncidentsInboxKpiHeader
            summary={summary}
            filters={filters}
            onApplyFilters={(next) => { setFilters(next); setShowAutonomous(false); }}
            autonomous={{
              count: autonomous.incidents.length,
              active: showAutonomous,
              onToggle: toggleAutonomous,
            }}
          />
        </div>

        {showAutonomous ? (
          <div>
            <div className="flex items-center px-4 pb-2">
              <button
                type="button"
                onClick={() => setShowAutonomous(false)}
                className="inline-flex items-center gap-1.5 rounded-card border border-primary/15 px-2.5 py-1 typo-caption text-foreground transition-colors hover:bg-secondary/40 focus-ring"
              >
                <Inbox className="h-3.5 w-3.5" aria-hidden="true" />
                {COPY.backToInbox}
              </button>
            </div>
            {autonomousVariant === 'table' ? (
              <AutonomousLogTable
                incidents={autonomous.incidents}
                loading={autonomous.loading}
                onOpenIncident={openDetail}
              />
            ) : (
              <AutonomousLogTrail
                incidents={autonomous.incidents}
                loading={autonomous.loading}
                onOpenIncident={openDetail}
              />
            )}
          </div>
        ) : (
          <>
            <IncidentsFilterBar filters={filters} onChange={setFilters} />

            {error && (
              <div className="px-4 py-3">
                <InlineErrorBanner
                  message={`${t.overview.incidents.load_failed}: ${error}`}
                  onRetry={() => void refresh()}
                />
              </div>
            )}

            {truncated && (
              <div className="flex items-center gap-2 px-4 py-2 border-b border-primary/10 bg-secondary/20">
                <span className="typo-caption text-foreground">
                  {t.overview.incidents.list_truncated.replace('{limit}', String(DEFAULT_LIMIT))}
                </span>
              </div>
            )}

            {isInitialLoading ? (
              <ListSkeleton calm rows={6} rowHeight={56} />
            ) : !loading && incidents.length === 0 ? (
              <div className="flex items-center justify-center py-16">
                {isNarrowed ? (
                  <EmptyState
                    icon={Inbox}
                    title={t.overview.incidents.empty_filtered_title}
                    subtitle={t.overview.incidents.empty_state_filtered}
                  />
                ) : (
                  <InboxZero
                    title={t.overview.incidents.empty_open_title}
                    subtitle={t.overview.incidents.empty_state_open}
                    celebrate={justCleared}
                  />
                )}
              </div>
            ) : variant === 'ledger' ? (
              <IncidentsLedgerView {...ledgerProps} />
            ) : (
              <IncidentsConsoleView {...ledgerProps} />
            )}
          </>
        )}
      </ContentBody>

      {detailIncident && (
        <IncidentDetailModal
          incident={detailIncident}
          onClose={() => setDetailIncident(null)}
          onChanged={() => void refresh()}
          onOpenIncident={(inc) => setDetailIncident(inc)}
          onFilterPersona={(personaId) =>
            setFilters({ statuses: null, severities: null, source_tables: null, persona_id: personaId, since: null })
          }
        />
      )}
    </ContentBox>
  );
}
