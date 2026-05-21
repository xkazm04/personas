import { useEffect, useMemo, useState } from 'react';
import {
  ChevronRight,
  GitBranch,
  Loader2,
  ScrollText,
  Search,
} from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import {
  companionListDesignDecisions,
  type CompanionDesignDecision,
} from '@/api/companion';

/**
 * Retrospective view of every design decision Athena has logged across
 * sessions. Each row reads `<label>  →  <choice>` with rationale below;
 * a filter input narrows by `personaContext` (sent as the backend filter
 * AND used to highlight matches client-side for instant feedback).
 *
 * Rows are immutable — there's no edit/delete UI here. To correct a
 * decision, the user asks Athena to re-emit a `show_decision_log` with
 * the updated entry; the original stays put as audit trail.
 */
export default function DecisionsPanel() {
  const { t } = useTranslation();
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<CompanionDesignDecision[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Server-side filter on the personaContext column. Empty filter → all
  // rows. We refetch on every filter commit so reloads stay
  // authoritative even if the user comes back hours later.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const trimmed = filter.trim();
    const probe = trimmed.length > 0 ? trimmed : null;
    companionListDesignDecisions(probe, 200)
      .then((items) => {
        if (cancelled) return;
        setRows(items);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
        silentCatch('companion_list_design_decisions')(err);
      });
    return () => {
      cancelled = true;
    };
  }, [filter]);

  // Group by persona_context so a long retrospective doesn't blur into
  // one undifferentiated stream. Decisions without a context get grouped
  // under "Unscoped".
  const grouped = useMemo(() => {
    const buckets = new Map<string, CompanionDesignDecision[]>();
    for (const row of rows) {
      const key = row.personaContext?.trim() || '_unscoped';
      const arr = buckets.get(key) ?? [];
      arr.push(row);
      buckets.set(key, arr);
    }
    return Array.from(buckets.entries()).map(([key, items]) => ({
      key,
      label:
        key === '_unscoped'
          ? t.plugins.companion.decisions_panel_unscoped
          : key,
      items,
    }));
  }, [rows, t]);

  return (
    <div className="flex flex-col gap-4 p-6 max-w-4xl mx-auto w-full">
      <header className="space-y-2">
        <h1 className="typo-h3 text-foreground/95 inline-flex items-center gap-2">
          <ScrollText className="w-5 h-5 text-fuchsia-400" />
          {t.plugins.companion.decisions_panel_title}
        </h1>
        <p className="typo-body text-foreground leading-relaxed">
          {t.plugins.companion.decisions_panel_subtitle}
        </p>
      </header>
      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-foreground" />
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t.plugins.companion.decisions_panel_filter_placeholder}
          className="w-full pl-8 pr-3 py-1.5 rounded-input bg-secondary/50 border border-foreground/15 typo-caption text-foreground/90 focus-ring"
          data-testid="companion-decisions-filter"
        />
      </div>
      {loading && (
        <div className="flex items-center gap-2 typo-caption text-foreground">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          {t.plugins.companion.decisions_panel_loading}
        </div>
      )}
      {!loading && error && (
        <div className="rounded-card border border-rose-500/30 bg-rose-500/10 px-3 py-2 typo-caption text-rose-400">
          {error}
        </div>
      )}
      {!loading && !error && rows.length === 0 && (
        <div className="rounded-card border border-foreground/10 bg-secondary/40 p-4 typo-caption text-foreground">
          {filter.trim().length > 0
            ? t.plugins.companion.decisions_panel_empty_filtered
            : t.plugins.companion.decisions_panel_empty}
        </div>
      )}
      {!loading && rows.length > 0 && (
        <div className="space-y-5">
          {grouped.map((group) => (
            <section
              key={group.key}
              className="space-y-2"
              data-context-key={group.key}
            >
              <h2 className="typo-caption font-medium text-foreground uppercase tracking-wide">
                {group.label}{' '}
                <span className="text-foreground normal-case">
                  ({group.items.length})
                </span>
              </h2>
              <ol className="relative space-y-2 pl-4 border-l border-fuchsia-500/20">
                {group.items.map((row) => (
                  <li
                    key={row.id}
                    className="relative space-y-1 pl-2"
                    data-decision-id={row.id}
                  >
                    <span
                      aria-hidden
                      className="absolute -left-[5px] top-2 w-2 h-2 rounded-full bg-fuchsia-500/45 ring-2 ring-fuchsia-500/20"
                    />
                    <div className="flex items-baseline gap-1.5 typo-body text-foreground/90">
                      <span className="font-medium">{row.label}</span>
                      <ChevronRight className="w-3 h-3 text-foreground shrink-0" />
                      <span>{row.choice}</span>
                      <span className="text-foreground typo-caption ml-auto">
                        {prettyDate(row.decisionTimestamp ?? row.createdAt)}
                      </span>
                    </div>
                    <div className="flex items-baseline gap-1.5 typo-caption text-foreground">
                      <GitBranch className="w-3 h-3 text-foreground shrink-0" />
                      <span className="leading-relaxed">{row.rationale}</span>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function prettyDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const now = new Date();
    const sameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    if (sameDay) {
      return d.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
      });
    }
    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric',
    });
  } catch {
    return iso;
  }
}
