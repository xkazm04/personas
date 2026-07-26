import { useCallback, useEffect, useMemo, useState } from 'react';
import { History, RefreshCw, AlertTriangle, ChevronDown } from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import {
  listSettingsAuditEntries,
  type SettingsAuditEntry,
} from '@/api/system/settings';
import { formatRelativeTime, formatTimestamp } from '@/lib/utils/formatters';
import { useTranslation } from '@/i18n/useTranslation';
import { RevealItem } from '@/features/shared/components/display/RevealItem';
import { useRevealTracker } from '@/hooks/utility/interaction/useProgressiveReveal';

const PAGE_SIZE = 100;

/**
 * Module-scoped session cache (docs/design/overview-loading.md, law 1). Settings
 * tabs unmount on panel switch, so without this the audit log falls back to a
 * cold ghost state on every return visit even though nothing changed. Keyed by
 * category filter; a fresh fetch still runs and silently replaces it.
 */
const historyCache = new Map<string, SettingsAuditEntry[]>();

/** Rows in the first viewport that play the one-shot entrance cascade. */
const CASCADE_ROWS = 20;
const HISTORY_ROW_H = 40;
const GHOST_BAR = 'rounded bg-primary/[0.06]';
const GHOST_TITLE_WIDTHS = ['w-40', 'w-28', 'w-52', 'w-32'];

const ACTION_COLOR: Record<string, string> = {
  create: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
  update: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
  toggle: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20',
  revoke: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  delete: 'text-red-400 bg-red-500/10 border-red-500/20',
};
const ACTION_COLOR_FALLBACK = 'text-foreground bg-secondary/30 border-primary/10';

export default function SettingsHistoryTab() {
  const { t } = useTranslation();
  const s = t.settings.history;

  // Map a raw audit category token (e.g. "quality_gates") to its localized
  // label. Unknown/future categories fall back to a humanized token so the
  // filter never renders a raw snake_case string.
  const categoryLabel = useCallback(
    (cat: string): string => {
      const labels = s.categories as Record<string, string | undefined>;
      return (
        labels?.[cat] ??
        cat.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
      );
    },
    [s],
  );

  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [entries, setEntries] = useState<SettingsAuditEntry[] | null>(
    () => historyCache.get('') ?? null,
  );
  // `loading` is in-flight-only, never a content gate — it decides whether an
  // EMPTY row region shows ghosts (fetch running) or the empty state (fetch
  // settled). Warm cache means it can be true while cached rows still paint.
  const [loading, setLoading] = useState(() => !historyCache.has(''));
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await listSettingsAuditEntries(
        PAGE_SIZE,
        categoryFilter || undefined,
      );
      setEntries(rows);
      historyCache.set(categoryFilter, rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [categoryFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const categories = useMemo(() => {
    if (!entries) return [] as string[];
    const set = new Set<string>();
    entries.forEach((e) => set.add(e.category));
    return Array.from(set).sort();
  }, [entries]);

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const visible = entries ?? [];
  // Ghosts only into genuine emptiness — never over rows already on screen
  // (cache or a previous fetch). `entries === null` means "never fetched
  // this session"; an empty array is a settled, real "no entries" result.
  const showGhost = loading && entries === null;
  // A category switch replays the first-viewport cascade for its result set;
  // a background refresh re-delivering the same ids does not.
  const enter = useRevealTracker(categoryFilter);

  return (
    <ContentBox>
      <ContentHeader
        icon={<History className="w-5 h-5 text-sky-400" />}
        title={s.title}
        subtitle={s.subtitle}
        actions={
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-interactive typo-caption text-foreground hover:text-primary hover:bg-secondary/40 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
            {s.refresh}
          </button>
        }
      />
      <ContentBody>
        {error && (
          <div className="flex items-center gap-2 typo-caption text-red-400 bg-red-400/10 rounded p-2 mb-3">
            <AlertTriangle size={14} />
            {error}
          </div>
        )}

        <p className="typo-body text-foreground leading-relaxed mb-4">{s.description}</p>

        <div className="flex items-center gap-3 mb-3">
          <label className="typo-caption text-foreground flex items-center gap-1.5">
            {s.filter_category}
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="px-2 py-1 typo-caption rounded-input bg-secondary/30 border border-primary/10 text-foreground focus:outline-none focus:border-primary/40"
            >
              <option value="">{s.filter_all}</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {categoryLabel(c)}
                </option>
              ))}
            </select>
          </label>
          {entries && entries.length === PAGE_SIZE && (
            <span className="typo-caption text-foreground ml-auto">{s.showing_max}</span>
          )}
        </div>

        {showGhost ? (
          <>
            <span className="sr-only" role="status">{s.loading}</span>
            <HistoryGhostRows />
          </>
        ) : visible.length === 0 ? (
          <div className="typo-caption text-foreground py-10 text-center bg-secondary/20 rounded">
            {categoryFilter ? s.empty_filtered : s.empty}
          </div>
        ) : (
          <div className="space-y-1">
            {visible.map((entry, index) => {
              const isExpanded = expanded.has(entry.id);
              const hasDetails =
                (entry.beforeValue !== null && entry.beforeValue !== undefined) ||
                (entry.afterValue !== null && entry.afterValue !== undefined);
              const actionClass = ACTION_COLOR[entry.action] ?? ACTION_COLOR_FALLBACK;
              return (
                <RevealItem
                  key={entry.id}
                  revealId={entry.id}
                  order={index}
                  hasEntered={(id) => index >= CASCADE_ROWS || enter.hasEntered(id)}
                  markEntered={enter.markEntered}
                  className="rounded-card border border-border/30 bg-secondary/20 overflow-hidden block"
                >
                  <button
                    type="button"
                    onClick={() => hasDetails && toggleExpanded(entry.id)}
                    disabled={!hasDetails}
                    className={`w-full flex items-center gap-3 px-3 py-2 ${
                      hasDetails ? 'hover:bg-secondary/40 cursor-pointer' : 'cursor-default'
                    } transition-colors`}
                  >
                    <span
                      className={`typo-caption px-1.5 py-0.5 rounded border uppercase tracking-wider ${actionClass}`}
                    >
                      {entry.action}
                    </span>
                    <span className="typo-caption text-foreground uppercase tracking-wider">
                      {categoryLabel(entry.category)}
                    </span>
                    <span className="typo-body font-medium text-foreground truncate flex-1 text-left">
                      {entry.settingKey}
                    </span>
                    {entry.actor && (
                      <span className="typo-caption text-foreground bg-secondary/40 px-1.5 py-0.5 rounded">
                        {entry.actor}
                      </span>
                    )}
                    <span
                      className="typo-caption text-foreground shrink-0"
                      title={formatTimestamp(entry.createdAt)}
                    >
                      {formatRelativeTime(entry.createdAt, '', { dateFallbackDays: 30 })}
                    </span>
                    {hasDetails && (
                      <ChevronDown
                        size={12}
                        className={`text-foreground transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                      />
                    )}
                  </button>
                  {isExpanded && hasDetails && (
                    <div className="border-t border-border/20 bg-secondary/10 px-3 py-2 space-y-2 typo-code">
                      {entry.beforeValue !== null && entry.beforeValue !== undefined && (
                        <div>
                          <div className="typo-caption text-foreground mb-0.5">{s.before}</div>
                          <pre className="bg-secondary/30 rounded p-2 text-foreground whitespace-pre-wrap break-all">
                            {entry.beforeValue}
                          </pre>
                        </div>
                      )}
                      {entry.afterValue !== null && entry.afterValue !== undefined && (
                        <div>
                          <div className="typo-caption text-foreground mb-0.5">{s.after}</div>
                          <pre className="bg-secondary/30 rounded p-2 text-foreground whitespace-pre-wrap break-all">
                            {entry.afterValue}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </RevealItem>
              );
            })}
          </div>
        )}
      </ContentBody>
    </ContentBox>
  );
}

// ---------------------------------------------------------------------------
// HistoryGhostRows — calm, delayed ghost rows shown only while the audit log
// has never been fetched this session (docs/design/overview-loading.md §C).
// Same row height/geometry as a real entry row so the ghost→content swap
// moves nothing. No `animate-pulse` — the entrance stagger is the only motion.
// ---------------------------------------------------------------------------
function HistoryGhostRows() {
  return (
    <div className="space-y-1" aria-hidden="true">
      {Array.from({ length: 8 }).map((_, i) => {
        const titleW = GHOST_TITLE_WIDTHS[i % GHOST_TITLE_WIDTHS.length];
        const delay = `${120 + i * 35}ms`;
        return (
          <div
            key={i}
            className="flex items-center gap-3 px-3 rounded-card border border-border/20 bg-secondary/10 animate-fade-in"
            style={{ height: HISTORY_ROW_H, animationDelay: delay }}
          >
            <span className={`h-4 w-14 rounded border border-transparent ${GHOST_BAR}`} />
            <span className={`h-3 w-20 ${GHOST_BAR}`} />
            <span className={`h-3.5 ${titleW} max-w-[40%] ${GHOST_BAR}`} />
            <span className={`h-3 w-16 ${GHOST_BAR} ml-auto`} />
          </div>
        );
      })}
    </div>
  );
}
