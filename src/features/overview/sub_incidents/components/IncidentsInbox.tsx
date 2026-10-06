// The incidents inbox — a flat, paginated ledger of everything that needs a
// human, plus a one-click switch to the log of what the system handled itself.
//
// This shell owns everything that is NOT the row treatment: data, filters,
// actions, deep-link, keyboard triage, the detail modal, the last-seen marker
// and the autonomous toggle. Grouping is gone by construction — the shell never
// groups, so the ledger below is a plain list with its own sort + pagination.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Inbox, Trash2 } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import EmptyState, { InboxZero } from '@/features/shared/components/feedback/ScenarioEmptyState';
import { ConfirmDialog } from '@/features/shared/components/feedback/ConfirmDialog';
import { InlineErrorBanner } from '@/features/shared/components/feedback/InlineErrorBanner';
import Button from '@/features/shared/components/buttons/Button';
import { ListSkeleton } from '@/features/shared/components/layout/ListSkeleton';
import { bulkResolveAuditIncidents } from '@/api/overview/incidents';
import { toastCatch } from '@/lib/silentCatch';
import { useIncidentsData, DEFAULT_LIMIT } from '../libs/useIncidentsData';
import { useIncidentActions } from '../libs/useIncidentActions';
import { useAutonomousIncidents } from '../libs/useAutonomousIncidents';
import { useIncidentKeyboardTriage } from '../libs/useIncidentKeyboardTriage';
import { useIncidentDeepLinkOpen } from '../libs/useIncidentDeepLinkOpen';
import { useIncidentInboxPersistence } from '../libs/useIncidentInboxPersistence';
import { IncidentsInboxKpiHeader } from './IncidentsInboxKpiHeader';
import { IncidentsFilterBar } from './IncidentsFilterBar';
import { IncidentDetailModal } from './IncidentDetailModal';
import { IncidentsLedgerDossier } from './ledger/IncidentsLedgerDossier';
import { AutonomousLogPanel } from './autonomous/AutonomousLogPanel';
import type { AuditIncident } from '@/lib/bindings/AuditIncident';
import { isNarrowedFilters } from '../libs/incidentFilterDefaults';
import {
  useDecisionDeckOpen,
  useReloadOnDeckClose,
} from '@/features/overview/sub_manual-review/libs/decisionDeckDoors';
import { openIncidentDoor } from '../libs/incidentDeckDoor';

export default function IncidentsInbox() {
  const { t, tx } = useTranslation();
  const { filters, setFilters, lastSeenAt } = useIncidentInboxPersistence();
  const [detailIncident, setDetailIncident] = useState<AuditIncident | null>(null);
  const [justCleared, setJustCleared] = useState(false);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [showAutonomous, setShowAutonomous] = useState(false);
  // Armed by an actual incident action so a filter change that yields zero
  // never triggers the inbox-zero celebration — only clearing the inbox does.
  const [clearedByAction, setClearedByAction] = useState(false);

  const { incidents, summary, loading, summaryLoading, error, refresh, truncated } = useIncidentsData(filters);
  const autonomous = useAutonomousIncidents();
  const [confirmingClearAll, setConfirmingClearAll] = useState(false);

  // What "clear the inbox" actually clears: every listed incident that is still
  // asking for something. Already-closed rows are left alone so the count in
  // the dialog is the count of rows that will visibly change.
  const clearableIds = useMemo(
    () => incidents.filter((i) => i.status !== 'resolved' && i.status !== 'dismissed').map((i) => i.id),
    [incidents],
  );

  const onAfterChange = useCallback(async () => {
    setClearedByAction(true);
    await refresh();
  }, [refresh]);
  const actions = useIncidentActions({ onAfterChange });

  // History view rule: an open incident opens the Decision Deck, a closed one
  // the detail modal (`openIncidentDoor`, shared by every door into a row).
  const openDetail = useCallback(
    (incident: AuditIncident) => { openIncidentDoor(incident, setDetailIncident); },
    [],
  );
  const deckOpen = useDecisionDeckOpen();
  // The deck writes through the roster's doors; the ledger re-reads on close.
  useReloadOnDeckClose(refresh);
  useIncidentDeepLinkOpen(incidents, openDetail);

  // The ledger reports the rows it is actually showing (its current page, in
  // its sort order) — keyboard triage then walks exactly what is on screen.
  const [pageRows, setPageRows] = useState<AuditIncident[]>([]);
  const onPageRowsChange = useCallback((rows: AuditIncident[]) => setPageRows(rows), []);

  const { acknowledge, resolve, dismiss, reopen } = actions;
  useIncidentKeyboardTriage({
    rows: pageRows,
    focusedId,
    setFocusedId,
    enabled: detailIncident === null && !showAutonomous && !deckOpen,
    onOpenDetail: openDetail,
    acknowledge,
    resolve,
    announce: setAnnouncement,
  });

  /**
   * Clear the inbox in one action, behind `ConfirmDialog`.
   *
   * **It resolves; it does not delete.** There is no delete door for incidents
   * on the Rust side — `commands/execution/audit_incidents.rs` exposes list /
   * get / summary / acknowledge / in-progress / resolve / dismiss / reopen and
   * two bulk commands, and no `delete_*` of any shape (checked 2026-10-04;
   * `delete_all_manual_reviews` exists for the sibling Approvals surface, so
   * the asymmetry is real and deliberate to leave in place rather than close
   * with an unreviewed destructive command). `bulk_resolve_audit_incidents` is
   * the only mass-clear door that exists, it empties the default (open) view,
   * and every row it touches is reversible through Reopen — which is why the
   * dialog says "resolve", names the count, and does not promise a delete.
   */
  const handleClearAll = useCallback(async () => {
    try {
      await bulkResolveAuditIncidents(clearableIds);
      await refresh();
    } catch (err) {
      toastCatch('IncidentsInbox:clearAll', t.overview.incidents.clear_all_failed)(err);
    } finally {
      setConfirmingClearAll(false);
    }
  }, [clearableIds, refresh, t.overview.incidents.clear_all_failed]);

  const handleAcknowledge = useCallback((id: string) => void acknowledge(id), [acknowledge]);
  const handleResolve = useCallback((id: string) => void resolve(id), [resolve]);
  const handleDismiss = useCallback((id: string) => void dismiss(id), [dismiss]);
  const handleReopen = useCallback((id: string) => void reopen(id), [reopen]);

  const isNarrowed = isNarrowedFilters(filters);
  const isInitialLoading = loading && incidents.length === 0;

  // Detect an action-driven drain to zero, evaluated once the refresh settles.
  useEffect(() => {
    if (loading) return;
    if (incidents.length > 0) {
      setJustCleared(false);
      setClearedByAction(false);
      return;
    }
    if (clearedByAction && !isNarrowed) setJustCleared(true);
    setClearedByAction(false);
  }, [loading, incidents.length, isNarrowed, clearedByAction]);

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
    // The cap notice now rides in the pager's footer (see LedgerPager.note).
    footerNote: truncated
      ? t.overview.incidents.list_truncated.replace('{limit}', String(DEFAULT_LIMIT))
      : undefined,
  }), [incidents, focusedId, lastSeenAt, openDetail, handleAcknowledge, handleResolve, handleDismiss, handleReopen, onPageRowsChange, truncated, t.overview.incidents.list_truncated]);

  return (
    <ContentBox data-testid="incidents-inbox">
      <ContentHeader
        icon={<Inbox className="w-5 h-5 text-amber-400" />}
        iconColor="amber"
        title={t.overview.incidents.title}
        subtitle={t.overview.incidents.subtitle}
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => { void refresh(); void autonomous.refresh(); }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 typo-caption rounded-card border border-primary/15 text-foreground hover:bg-secondary/40 transition-colors focus-ring"
              aria-label={t.overview.incidents.refresh}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              {t.overview.incidents.refresh}
            </button>
            {/* Hidden when there is nothing to clear: an action that would do
                nothing must not offer itself. */}
            {clearableIds.length > 0 && (
              <Button
                variant="accent"
                tone="error"
                size="sm"
                icon={<Trash2 className="h-3.5 w-3.5" />}
                onClick={() => setConfirmingClearAll(true)}
                aria-label={t.overview.incidents.clear_all}
              >
                {t.overview.incidents.clear_all}
              </Button>
            )}
          </div>
        }
      />

      <ContentBody>
        <div aria-live="polite" aria-atomic="true" className="sr-only">{announcement}</div>


        <div className="px-4 pt-3 pb-2">
          <IncidentsInboxKpiHeader
            summary={summary}
            pending={summaryLoading}
            filters={filters}
            onApplyFilters={(next) => { setFilters(next); setShowAutonomous(false); }}
            autonomous={{
              count: autonomous.incidents.length,
              active: showAutonomous,
              onToggle: () => setShowAutonomous((v) => !v),
            }}
          />
        </div>

        {showAutonomous ? (
          <AutonomousLogPanel
            incidents={autonomous.incidents}
            loading={autonomous.loading}
            onOpenIncident={openDetail}
            onBack={() => setShowAutonomous(false)}
          />
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

            {/* The cap notice used to sit here, between the filter bar and the
                column header. It now rides in the ledger's own footer, under
                the last row and beside the range it qualifies (2026-10-04). */}

            {/* Nothing on screen yet + a fetch in flight: calm ghost rows. A
                background refresh with rows already visible never reaches this
                branch (docs/design/overview-loading.md law 1). */}
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
            ) : (
              <IncidentsLedgerDossier {...ledgerProps} />
            )}
          </>
        )}
      </ContentBody>

      {confirmingClearAll && (
        <ConfirmDialog
          danger
          title={t.overview.incidents.clear_all_confirm_title}
          body={tx(t.overview.incidents.clear_all_confirm_body, { count: clearableIds.length })}
          confirmLabel={t.overview.incidents.clear_all_confirm_cta}
          onConfirm={handleClearAll}
          onCancel={() => setConfirmingClearAll(false)}
        />
      )}

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
