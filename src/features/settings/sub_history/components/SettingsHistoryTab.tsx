import { useCallback, useEffect, useMemo, useState } from 'react';
import { History, RefreshCw, AlertTriangle, ChevronDown } from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import {
  listSettingsAuditEntries,
  type SettingsAuditEntry,
} from '@/api/system/settings';
import { formatRelativeTime, formatTimestamp } from '@/lib/utils/formatters';
import { useTranslation } from '@/i18n/useTranslation';

const PAGE_SIZE = 100;

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

  const [entries, setEntries] = useState<SettingsAuditEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string>('');
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
                  {c}
                </option>
              ))}
            </select>
          </label>
          {entries && entries.length === PAGE_SIZE && (
            <span className="typo-caption text-foreground ml-auto">{s.showing_max}</span>
          )}
        </div>

        {loading && !entries && (
          <div className="typo-caption text-foreground py-6 text-center">{s.loading}</div>
        )}

        {!loading && visible.length === 0 && (
          <div className="typo-caption text-foreground py-10 text-center bg-secondary/20 rounded">
            {categoryFilter ? s.empty_filtered : s.empty}
          </div>
        )}

        <div className="space-y-1">
          {visible.map((entry) => {
            const isExpanded = expanded.has(entry.id);
            const hasDetails =
              (entry.beforeValue !== null && entry.beforeValue !== undefined) ||
              (entry.afterValue !== null && entry.afterValue !== undefined);
            const actionClass = ACTION_COLOR[entry.action] ?? ACTION_COLOR_FALLBACK;
            return (
              <div
                key={entry.id}
                className="rounded-card border border-border/30 bg-secondary/20 overflow-hidden"
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
                    {entry.category}
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
              </div>
            );
          })}
        </div>
      </ContentBody>
    </ContentBox>
  );
}
