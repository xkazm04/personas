import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Archive,
  RefreshCw,
  Trash2,
  AlertTriangle,
  Ban,
  ListChecks,
  Layers,
  X,
  ChevronDown,
  ChevronRight,
  Filter,
} from 'lucide-react';
import {
  listDeadLetterEvents,
  retryDeadLetterEvent,
  discardDeadLetterEvent,
  getDeadLetterConfig,
  bulkRetryDeadLetterEvents,
  bulkDiscardDeadLetterEvents,
} from '@/api/overview/events';
import { ConfirmDestructiveModal, useConfirmDestructive } from '@/features/shared/components/overlays/ConfirmDestructiveModal';
import { useToastStore } from '@/stores/toastStore';
import type { PersonaEvent } from '@/lib/types/types';
import type { BulkDeadLetterOutcome } from '@/lib/bindings/BulkDeadLetterOutcome';
import type { BulkDeadLetterFailure } from '@/lib/bindings/BulkDeadLetterFailure';
import { useTranslation } from '@/i18n/useTranslation';
import EmptyState, { NoResults } from '@/features/shared/components/feedback/EmptyState';
import { ListSkeleton } from '@/features/shared/components/layout/ListSkeleton';

/**
 * First-paint default while `getDeadLetterConfig` is in flight. Matches the
 * historical Rust default; the real cap is fetched on mount and overrides
 * this so UI labels never drift from `MAX_MANUAL_RETRIES` in `events.rs`.
 */
const MAX_MANUAL_RETRIES_FALLBACK = 5;

type AgeFilter = 'any' | '15m' | '1h' | '24h' | 'old';
type ViewMode = 'list' | 'grouped';

interface Filters {
  eventType: string;
  sourceType: string;
  errorContains: string;
  age: AgeFilter;
}

const EMPTY_FILTERS: Filters = {
  eventType: '',
  sourceType: '',
  errorContains: '',
  age: 'any',
};

/**
 * Jaccard similarity threshold above which two errors are considered the
 * same failure mode. Tuned by eye on real DLQ data: 0.55 keeps "connection
 * refused tcp 1.2.3.4:5432" and "connection refused tcp 4.3.2.1:5432"
 * together while splitting genuinely different stack traces.
 */
const ERROR_SIMILARITY_THRESHOLD = 0.55;

/** Tokenize an error message for Jaccard comparison — lowercase, drop
 *  numbers/short tokens so volatile bits (ids, timestamps, ports) don't
 *  shatter otherwise-identical errors into singleton groups. */
function tokenizeError(msg: string): Set<string> {
  return new Set(
    msg
      .toLowerCase()
      .replace(/[0-9]+/g, ' ')
      .split(/[^a-z]+/)
      .filter((tok) => tok.length >= 3),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const tok of a) if (b.has(tok)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

interface ErrorGroup {
  /** Stable id derived from the first event in the group. */
  key: string;
  /** Representative error message (the first observed). */
  representative: string;
  events: PersonaEvent[];
}

/** Cluster events whose error_message tokenize-Jaccards above the threshold.
 *  O(n*k) where k = number of groups; fine for the 100-event window. */
function clusterByErrorPattern(events: PersonaEvent[]): ErrorGroup[] {
  const groups: Array<ErrorGroup & { tokens: Set<string> }> = [];

  for (const evt of events) {
    const msg = evt.error_message ?? '';
    const tokens = tokenizeError(msg);

    let placed = false;
    for (const g of groups) {
      if (jaccard(tokens, g.tokens) >= ERROR_SIMILARITY_THRESHOLD) {
        g.events.push(evt);
        placed = true;
        break;
      }
    }
    if (!placed) {
      groups.push({
        key: evt.id,
        representative: msg || '(no error message)',
        tokens,
        events: [evt],
      });
    }
  }

  return groups
    .map(({ tokens: _t, ...rest }) => rest)
    .sort((a, b) => b.events.length - a.events.length);
}

export function DeadLetterTab() {
  const { t, tx } = useTranslation();
  const [events, setEvents] = useState<PersonaEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [maxManualRetries, setMaxManualRetries] = useState<number>(MAX_MANUAL_RETRIES_FALLBACK);
  const [actionsInProgress, setActionsInProgress] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [bulkInFlight, setBulkInFlight] = useState(false);

  const startAction = useCallback((id: string) => {
    setActionsInProgress((prev) => new Set(prev).add(id));
  }, []);
  const endAction = useCallback((id: string) => {
    setActionsInProgress((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);
  const { modal, confirm } = useConfirmDestructive();
  const addToast = useToastStore((s) => s.addToast);

  const loadEvents = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listDeadLetterEvents(100);
      setEvents(data);
      setSelected((prev) => {
        // Drop selections for ids that are no longer in the queue.
        const ids = new Set(data.map((e) => e.id));
        const next = new Set<string>();
        for (const id of prev) if (ids.has(id)) next.add(id);
        return next;
      });
    } catch {
      addToast('Failed to load dead letter events', 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => { void loadEvents(); }, [loadEvents]);

  useEffect(() => {
    let cancelled = false;
    getDeadLetterConfig().then((cfg) => {
      if (!cancelled) setMaxManualRetries(cfg.maxManualRetries);
    }).catch(() => { /* fallback retained */ });
    return () => { cancelled = true; };
  }, []);

  // ---- Filtering ---------------------------------------------------------

  const filtered = useMemo(() => {
    const now = Date.now();
    const ageMs: Record<AgeFilter, number | null> = {
      any: null,
      '15m': 15 * 60_000,
      '1h': 60 * 60_000,
      '24h': 24 * 60 * 60_000,
      old: -1,
    };

    const evt = filters.eventType.trim().toLowerCase();
    const src = filters.sourceType.trim().toLowerCase();
    const err = filters.errorContains.trim().toLowerCase();
    const cutoff = ageMs[filters.age];

    return events.filter((e) => {
      if (evt && !e.event_type.toLowerCase().includes(evt)) return false;
      if (src && !e.source_type.toLowerCase().includes(src)) return false;
      if (err && !(e.error_message ?? '').toLowerCase().includes(err)) return false;
      if (cutoff !== null) {
        const age = now - new Date(e.created_at).getTime();
        if (cutoff === -1) {
          if (age <= 24 * 60 * 60_000) return false;
        } else if (age > cutoff) {
          return false;
        }
      }
      return true;
    });
  }, [events, filters]);

  const filtersDirty =
    filters.eventType !== '' ||
    filters.sourceType !== '' ||
    filters.errorContains !== '' ||
    filters.age !== 'any';

  // ---- Selection ---------------------------------------------------------

  const filteredIds = useMemo(() => new Set(filtered.map((e) => e.id)), [filtered]);
  const selectableFilteredIds = useMemo(
    () => filtered.filter((e) => e.retry_count < maxManualRetries).map((e) => e.id),
    [filtered, maxManualRetries],
  );
  const visibleSelectedCount = useMemo(() => {
    let n = 0;
    for (const id of selected) if (filteredIds.has(id)) n++;
    return n;
  }, [selected, filteredIds]);

  const toggleOne = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectVisible = useCallback(() => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of filtered.map((e) => e.id)) next.add(id);
      return next;
    });
  }, [filtered]);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  // ---- Grouping ----------------------------------------------------------

  const groups = useMemo(() => clusterByErrorPattern(filtered), [filtered]);

  const toggleGroup = useCallback((key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const selectGroup = useCallback((group: ErrorGroup) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const evt of group.events) {
        if (evt.retry_count < maxManualRetries) next.add(evt.id);
        else next.add(evt.id);
      }
      return next;
    });
  }, [maxManualRetries]);

  // ---- Bulk actions ------------------------------------------------------

  const summarizeFailures = useCallback((failed: BulkDeadLetterFailure[]): string => {
    const counts: Record<string, number> = {};
    for (const f of failed) counts[f.reason] = (counts[f.reason] ?? 0) + 1;
    const labelFor = (reason: string) => {
      if (reason === 'retry_exhausted') return t.triggers.dead_letter_bulk_failure_retry_exhausted;
      if (reason === 'not_found') return t.triggers.dead_letter_bulk_failure_not_found;
      return t.triggers.dead_letter_bulk_failure_wrong_status;
    };
    return Object.entries(counts)
      .map(([reason, count]) => `${count} ${labelFor(reason)}`)
      .join(', ');
  }, [t]);

  const applyOutcome = useCallback((outcome: BulkDeadLetterOutcome) => {
    const succeeded = new Set(outcome.succeeded);
    setEvents((prev) => prev.filter((e) => !succeeded.has(e.id)));
    setSelected((prev) => {
      const next = new Set<string>();
      for (const id of prev) if (!succeeded.has(id)) next.add(id);
      return next;
    });
  }, []);

  const runBulkRetry = useCallback(async (ids: string[]) => {
    const target = ids.filter((id) => {
      const evt = events.find((e) => e.id === id);
      return evt ? evt.retry_count < maxManualRetries : false;
    });
    if (target.length === 0) {
      addToast(t.triggers.dead_letter_bulk_failure_retry_exhausted, 'error');
      return;
    }
    setBulkInFlight(true);
    try {
      const outcome = await bulkRetryDeadLetterEvents(target);
      applyOutcome(outcome);
      const summary = tx(t.triggers.dead_letter_bulk_retry_summary, {
        success: outcome.succeeded.length,
        total: target.length,
      });
      if (outcome.failed.length > 0) {
        addToast(`${summary} — ${summarizeFailures(outcome.failed)}`, 'error');
      } else {
        addToast(summary, 'success');
      }
    } catch {
      addToast('Bulk retry failed — please try again', 'error');
    } finally {
      setBulkInFlight(false);
    }
  }, [events, maxManualRetries, applyOutcome, addToast, t, tx, summarizeFailures]);

  const runBulkDiscard = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    confirm({
      title: tx(t.triggers.dead_letter_bulk_discard_confirm_title, { count: ids.length }),
      message: t.triggers.dead_letter_bulk_discard_confirm_message,
      confirmLabel: t.triggers.dead_letter_discard,
      onConfirm: async () => {
        setBulkInFlight(true);
        try {
          const outcome = await bulkDiscardDeadLetterEvents(ids);
          applyOutcome(outcome);
          const summary = tx(t.triggers.dead_letter_bulk_discard_summary, {
            success: outcome.succeeded.length,
            total: ids.length,
          });
          if (outcome.failed.length > 0) {
            addToast(`${summary} — ${summarizeFailures(outcome.failed)}`, 'error');
          } else {
            addToast(summary, 'success');
          }
        } catch {
          addToast('Bulk discard failed — please try again', 'error');
        } finally {
          setBulkInFlight(false);
        }
      },
    });
  }, [confirm, applyOutcome, addToast, t, tx, summarizeFailures]);

  // ---- Single-row actions (preserved) -----------------------------------

  const handleRetry = async (id: string) => {
    startAction(id);
    try {
      await retryDeadLetterEvent(id);
      setEvents((prev) => prev.filter((e) => e.id !== id));
      setSelected((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } catch (err: unknown) {
      const kind = (err as { kind?: string })?.kind;
      if (kind === 'retry_exhausted') {
        addToast('Retry limit reached — this event cannot be retried again. Discard or investigate.', 'error');
      } else {
        addToast('Failed to retry event — please try again', 'error');
      }
    } finally {
      endAction(id);
    }
  };

  const handleDiscard = (evt: PersonaEvent) => {
    confirm({
      title: 'Discard Event',
      message: 'This dead-letter event will be permanently discarded.',
      confirmLabel: 'Discard',
      details: [
        { label: 'Type', value: evt.event_type },
        { label: 'Retries', value: String(evt.retry_count) },
      ],
      onConfirm: async () => {
        startAction(evt.id);
        try {
          await discardDeadLetterEvent(evt.id);
          setEvents((prev) => prev.filter((e) => e.id !== evt.id));
          setSelected((prev) => {
            if (!prev.has(evt.id)) return prev;
            const next = new Set(prev);
            next.delete(evt.id);
            return next;
          });
        } catch {
          addToast('Failed to discard event — please try again', 'error');
        } finally {
          endAction(evt.id);
        }
      },
    });
  };

  const formatDate = (dateStr: string) => {
    try { return new Date(dateStr).toLocaleString(); } catch { return dateStr; }
  };

  // ---- Render ------------------------------------------------------------

  const totalEvents = events.length;
  const allFilteredVisibleSelected =
    selectableFilteredIds.length > 0 && selectableFilteredIds.every((id) => selected.has(id));

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Archive className="w-5 h-5 text-red-400" />
            <h3 className="typo-heading font-semibold">{t.triggers.tab_dead_letter}</h3>
            <span className="typo-caption text-foreground">
              ({totalEvents} event{totalEvents !== 1 ? 's' : ''})
            </span>
            {filtersDirty && (
              <span className="typo-caption text-foreground/70">
                · {tx(t.triggers.dead_letter_filtered_summary, { visible: filtered.length, total: totalEvents })}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <div className="flex items-center rounded-card border border-border/50 overflow-hidden">
              <button
                onClick={() => setViewMode('list')}
                className={`flex items-center gap-1 px-2.5 py-1.5 typo-caption font-medium transition-colors ${
                  viewMode === 'list' ? 'bg-secondary text-foreground' : 'text-foreground/70 hover:bg-secondary/50'
                }`}
              >
                <ListChecks className="w-3 h-3" />
                {t.triggers.dead_letter_view_list}
              </button>
              <button
                onClick={() => setViewMode('grouped')}
                className={`flex items-center gap-1 px-2.5 py-1.5 typo-caption font-medium transition-colors ${
                  viewMode === 'grouped' ? 'bg-secondary text-foreground' : 'text-foreground/70 hover:bg-secondary/50'
                }`}
              >
                <Layers className="w-3 h-3" />
                {t.triggers.dead_letter_view_grouped}
              </button>
            </div>
            <button
              onClick={() => setFiltersOpen((v) => !v)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 typo-caption font-medium rounded-card transition-colors ${
                filtersOpen || filtersDirty
                  ? 'bg-secondary text-foreground'
                  : 'text-foreground hover:bg-secondary/50'
              }`}
            >
              <Filter className="w-3 h-3" />
              {t.triggers.dead_letter_filters_title}
            </button>
            <button
              onClick={() => void loadEvents()}
              className="flex items-center gap-1.5 px-2.5 py-1.5 typo-caption font-medium rounded-card text-foreground hover:bg-secondary/50 transition-colors"
            >
              <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
              {t.triggers.dead_letter_refresh}
            </button>
          </div>
        </div>

        <p className="typo-caption text-foreground">{t.triggers.dead_letter_help}</p>

        {filtersOpen && (
          <div className="rounded-card border border-border/50 bg-secondary/30 p-3 space-y-2">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <input
                type="text"
                value={filters.eventType}
                onChange={(e) => setFilters((f) => ({ ...f, eventType: e.target.value }))}
                placeholder={t.triggers.dead_letter_filter_event_type_placeholder}
                className="px-2.5 py-1.5 typo-caption rounded-input bg-background border border-border/50 focus:outline-none focus:border-primary"
              />
              <input
                type="text"
                value={filters.sourceType}
                onChange={(e) => setFilters((f) => ({ ...f, sourceType: e.target.value }))}
                placeholder={t.triggers.dead_letter_filter_source_type_placeholder}
                className="px-2.5 py-1.5 typo-caption rounded-input bg-background border border-border/50 focus:outline-none focus:border-primary"
              />
              <input
                type="text"
                value={filters.errorContains}
                onChange={(e) => setFilters((f) => ({ ...f, errorContains: e.target.value }))}
                placeholder={t.triggers.dead_letter_filter_error_placeholder}
                className="px-2.5 py-1.5 typo-caption rounded-input bg-background border border-border/50 focus:outline-none focus:border-primary"
              />
            </div>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="typo-caption text-foreground/70">
                  {t.triggers.dead_letter_filter_age}:
                </span>
                {(['any', '15m', '1h', '24h', 'old'] as const).map((age) => (
                  <button
                    key={age}
                    onClick={() => setFilters((f) => ({ ...f, age }))}
                    className={`px-2 py-0.5 typo-caption rounded-input transition-colors ${
                      filters.age === age
                        ? 'bg-primary/20 text-primary'
                        : 'bg-secondary/50 text-foreground/70 hover:bg-secondary'
                    }`}
                  >
                    {t.triggers[`dead_letter_filter_age_${age}` as const]}
                  </button>
                ))}
              </div>
              {filtersDirty && (
                <button
                  onClick={() => setFilters(EMPTY_FILTERS)}
                  className="flex items-center gap-1 px-2 py-0.5 typo-caption text-foreground/70 hover:text-foreground"
                >
                  <X className="w-3 h-3" />
                  {t.triggers.dead_letter_filters_clear}
                </button>
              )}
            </div>
          </div>
        )}

        {visibleSelectedCount > 0 && (
          <div className="flex items-center justify-between gap-2 rounded-card border border-primary/30 bg-primary/10 px-3 py-2">
            <span className="typo-caption font-medium text-foreground">
              {tx(t.triggers.dead_letter_selected_count, { count: visibleSelectedCount })}
            </span>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => void runBulkRetry(Array.from(selected).filter((id) => filteredIds.has(id)))}
                disabled={bulkInFlight}
                title={t.triggers.dead_letter_bulk_retry_title}
                className="flex items-center gap-1 px-2 py-1 typo-caption rounded-input bg-blue-500/20 text-blue-300 hover:bg-blue-500/30 disabled:opacity-50 transition-colors"
              >
                <RefreshCw className={`w-3 h-3 ${bulkInFlight ? 'animate-spin' : ''}`} />
                {tx(t.triggers.dead_letter_bulk_retry, { count: visibleSelectedCount })}
              </button>
              <button
                onClick={() => runBulkDiscard(Array.from(selected).filter((id) => filteredIds.has(id)))}
                disabled={bulkInFlight}
                title={t.triggers.dead_letter_bulk_discard_title}
                className="flex items-center gap-1 px-2 py-1 typo-caption rounded-input bg-secondary/50 text-foreground hover:bg-secondary disabled:opacity-50 transition-colors"
              >
                <Trash2 className="w-3 h-3" />
                {tx(t.triggers.dead_letter_bulk_discard, { count: visibleSelectedCount })}
              </button>
              <button
                onClick={clearSelection}
                className="flex items-center gap-1 px-2 py-1 typo-caption rounded-input text-foreground/70 hover:bg-secondary/50 transition-colors"
              >
                <X className="w-3 h-3" />
                {t.triggers.dead_letter_clear_selection}
              </button>
            </div>
          </div>
        )}

        {loading && events.length === 0 && (
          <ListSkeleton rows={4} rowHeight={64} className="rounded-card overflow-hidden" />
        )}

        {!loading && totalEvents === 0 && (
          <EmptyState
            icon={Archive}
            title={t.triggers.no_dead_letters}
            subtitle={t.triggers.all_events_processed}
          />
        )}

        {!loading && totalEvents > 0 && filtered.length === 0 && (
          <NoResults
            onReset={() => setFilters(EMPTY_FILTERS)}
            title={t.triggers.dead_letter_no_matches}
            subtitle={t.triggers.dead_letter_clear_filters_to_see}
          />
        )}

        {filtered.length > 0 && viewMode === 'list' && (
          <div className="space-y-2">
            {selectableFilteredIds.length > 0 && (
              <div className="flex items-center gap-2 px-1">
                <input
                  type="checkbox"
                  checked={allFilteredVisibleSelected}
                  onChange={(e) => (e.target.checked ? selectVisible() : clearSelection())}
                  className="rounded-input border-border accent-primary"
                  aria-label={t.triggers.dead_letter_select_visible}
                />
                <span className="typo-caption text-foreground/70">
                  {t.triggers.dead_letter_select_visible}
                </span>
              </div>
            )}
            <AnimatePresence initial={false}>
              {filtered.map((evt) => {
                const exhausted = evt.retry_count >= maxManualRetries;
                const isSelected = selected.has(evt.id);
                return (
                  <motion.div
                    key={evt.id}
                    layout
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -20, height: 0, marginBottom: 0, overflow: 'hidden' }}
                    transition={{ duration: 0.25, ease: 'easeInOut' }}
                    className={`rounded-card border p-4 space-y-2 ${
                      isSelected ? 'border-primary/50 bg-primary/5' : 'border-red-500/20 bg-red-500/5'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-2 flex-1 min-w-0">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleOne(evt.id)}
                          disabled={exhausted}
                          className="mt-1 rounded-input border-border accent-primary disabled:opacity-40"
                          aria-label={`Select event ${evt.id}`}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                            <span className="typo-body font-medium truncate">{evt.event_type}</span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono shrink-0 ${
                              exhausted
                                ? 'bg-orange-500/20 text-orange-300'
                                : 'bg-red-500/20 text-red-300'
                            }`}>
                              {evt.retry_count}/{maxManualRetries} retries
                              {exhausted && ' — exhausted'}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 typo-caption text-foreground">
                            <span>{t.triggers.dead_letter_source} {evt.source_type}</span>
                            {evt.source_id && <span>{t.triggers.dead_letter_id} {evt.source_id}</span>}
                            <span>{formatDate(evt.created_at)}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {exhausted ? (
                          <span
                            className="flex items-center gap-1 px-2 py-1 typo-caption rounded-input bg-orange-500/10 text-orange-400 cursor-not-allowed"
                            title={t.triggers.dead_letter_retry_exhausted_title}
                          >
                            <Ban className="w-3 h-3" />
                            {t.triggers.exhausted_label}
                          </span>
                        ) : (
                          <button
                            onClick={() => void handleRetry(evt.id)}
                            disabled={actionsInProgress.has(evt.id) || bulkInFlight}
                            className="flex items-center gap-1 px-2 py-1 typo-caption rounded-input bg-blue-500/20 text-blue-300 hover:bg-blue-500/30 disabled:opacity-50 transition-colors"
                            title={t.triggers.dead_letter_retry_title}
                          >
                            <RefreshCw className={`w-3 h-3 ${actionsInProgress.has(evt.id) ? 'animate-spin' : ''}`} />
                            {t.triggers.dead_letter_retry}
                          </button>
                        )}
                        <button
                          onClick={() => handleDiscard(evt)}
                          disabled={actionsInProgress.has(evt.id) || bulkInFlight}
                          className="flex items-center gap-1 px-2 py-1 typo-caption rounded-input bg-secondary/50 text-foreground hover:bg-secondary disabled:opacity-50 transition-colors"
                          title={t.triggers.dead_letter_discard_title}
                        >
                          <Trash2 className="w-3 h-3" />
                          {t.triggers.dead_letter_discard}
                        </button>
                      </div>
                    </div>

                    {evt.error_message && (
                      <div className="typo-code text-red-300/80 bg-red-500/10 rounded px-2.5 py-1.5 font-mono break-all">
                        {evt.error_message}
                      </div>
                    )}

                    {evt.payload && (
                      <LazyPayload payload={evt.payload} summaryLabel={t.triggers.dead_letter_payload} />
                    )}
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}

        {filtered.length > 0 && viewMode === 'grouped' && (
          <div className="space-y-2">
            {groups.map((group) => {
              const expanded = expandedGroups.has(group.key);
              const eligibleIds = group.events
                .filter((e) => e.retry_count < maxManualRetries)
                .map((e) => e.id);
              const allEventIds = group.events.map((e) => e.id);
              return (
                <div key={group.key} className="rounded-card border border-red-500/20 bg-red-500/5">
                  <div className="flex items-center justify-between gap-3 p-3">
                    <button
                      onClick={() => toggleGroup(group.key)}
                      className="flex items-start gap-2 flex-1 min-w-0 text-left hover:opacity-80 transition-opacity"
                      title={expanded ? t.triggers.dead_letter_group_collapse : t.triggers.dead_letter_group_expand}
                    >
                      {expanded ? (
                        <ChevronDown className="w-4 h-4 text-foreground/70 shrink-0 mt-0.5" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-foreground/70 shrink-0 mt-0.5" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                          <span className="typo-body font-medium truncate">
                            {tx(
                              group.events.length === 1
                                ? t.triggers.dead_letter_group_singular
                                : t.triggers.dead_letter_group_plural,
                              { count: group.events.length },
                            )}
                          </span>
                        </div>
                        <div className="typo-code text-red-300/80 break-all line-clamp-2">
                          {group.representative}
                        </div>
                      </div>
                    </button>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => selectGroup(group)}
                        className="flex items-center gap-1 px-2 py-1 typo-caption rounded-input bg-secondary/50 text-foreground hover:bg-secondary transition-colors"
                      >
                        <ListChecks className="w-3 h-3" />
                        {t.triggers.dead_letter_select_all}
                      </button>
                      <button
                        onClick={() => void runBulkRetry(eligibleIds)}
                        disabled={eligibleIds.length === 0 || bulkInFlight}
                        className="flex items-center gap-1 px-2 py-1 typo-caption rounded-input bg-blue-500/20 text-blue-300 hover:bg-blue-500/30 disabled:opacity-50 transition-colors"
                      >
                        <RefreshCw className={`w-3 h-3 ${bulkInFlight ? 'animate-spin' : ''}`} />
                        {t.triggers.dead_letter_group_retry}
                      </button>
                      <button
                        onClick={() => runBulkDiscard(allEventIds)}
                        disabled={bulkInFlight}
                        className="flex items-center gap-1 px-2 py-1 typo-caption rounded-input bg-secondary/50 text-foreground hover:bg-secondary disabled:opacity-50 transition-colors"
                      >
                        <Trash2 className="w-3 h-3" />
                        {t.triggers.dead_letter_group_discard}
                      </button>
                    </div>
                  </div>
                  {expanded && (
                    <div className="border-t border-red-500/10 px-3 py-2 space-y-1.5">
                      {group.events.map((evt) => {
                        const exhausted = evt.retry_count >= maxManualRetries;
                        const isSelected = selected.has(evt.id);
                        return (
                          <div
                            key={evt.id}
                            className={`flex items-center gap-2 px-2 py-1 rounded-input ${
                              isSelected ? 'bg-primary/10' : ''
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleOne(evt.id)}
                              disabled={exhausted}
                              className="rounded-input border-border accent-primary disabled:opacity-40"
                            />
                            <span className="typo-caption font-medium truncate flex-1">{evt.event_type}</span>
                            <span className="typo-caption text-foreground/60">
                              {evt.source_type} · {evt.retry_count}/{maxManualRetries}
                            </span>
                            <span className="typo-caption text-foreground/60 hidden md:inline">
                              {formatDate(evt.created_at)}
                            </span>
                            {exhausted ? (
                              <span className="flex items-center gap-1 px-1.5 py-0.5 typo-caption rounded-input bg-orange-500/10 text-orange-400">
                                <Ban className="w-3 h-3" />
                                {t.triggers.exhausted_label}
                              </span>
                            ) : (
                              <button
                                onClick={() => void handleRetry(evt.id)}
                                disabled={actionsInProgress.has(evt.id) || bulkInFlight}
                                className="px-1.5 py-0.5 typo-caption rounded-input text-blue-300 hover:bg-blue-500/20 disabled:opacity-50 transition-colors"
                              >
                                {t.triggers.dead_letter_retry}
                              </button>
                            )}
                            <button
                              onClick={() => handleDiscard(evt)}
                              disabled={actionsInProgress.has(evt.id) || bulkInFlight}
                              className="px-1.5 py-0.5 typo-caption rounded-input text-foreground hover:bg-secondary disabled:opacity-50 transition-colors"
                            >
                              {t.triggers.dead_letter_discard}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ConfirmDestructiveModal {...modal} />
    </div>
  );
}

function LazyPayload({ payload, summaryLabel }: { payload: string; summaryLabel: string }) {
  const [open, setOpen] = useState(false);
  const pretty = useMemo(() => {
    if (!open) return null;
    try { return JSON.stringify(JSON.parse(payload), null, 2); }
    catch { return payload; }
  }, [payload, open]);

  return (
    <details
      className="typo-caption"
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="text-foreground cursor-pointer hover:text-foreground transition-colors">
        {summaryLabel}
      </summary>
      {open && pretty !== null && (
        <pre className="mt-1 p-2 rounded bg-secondary/50 text-foreground overflow-x-auto text-[11px] max-h-32">
          {pretty}
        </pre>
      )}
    </details>
  );
}
