import { useState } from 'react';
import { Layers, ScrollText } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useDesignDecisions, type DecisionGroup } from './useDesignDecisions';
import {
  DecisionsEmpty,
  DecisionsErrorRow,
  DecisionsFilterInput,
  DecisionsLoadingRow,
  ScopeBanner,
} from './sharedBlocks';

/**
 * Retrospective view of every design decision Athena has logged across
 * sessions — the "Atlas" layout (winner of the 2026-06-10 /prototype
 * round; the old single-scroll baseline and the Ledger variant were
 * retired at consolidation).
 *
 * Mental model: each persona context is a place, not a section of one
 * long scroll. A left rail lists every context with its decision count;
 * the right pane opens the selected context as a single spacious reading
 * thread — choice as headline, rationale as full-width body — along a
 * thin timeline. Scope-first navigation means the reading pane only ever
 * holds one narrative at a time.
 *
 * Rows are immutable — there's no edit/delete UI here. To correct a
 * decision, the user asks Athena to re-emit a `show_decision_log` with
 * the updated entry; the original stays put as audit trail.
 *
 * Data/interaction contract (server-side personaContext filter,
 * auto-scope to the active build intent, "Unscoped" bucket, empty-state
 * launchpad) lives in `useDesignDecisions`; the scope banner, filter
 * input, and status blocks live in `sharedBlocks`.
 */
export default function DecisionsPanel() {
  const { t } = useTranslation();
  const d = useDesignDecisions();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // Reconcile inline: if the filter refetch dropped the selected context,
  // fall back to "all" rather than rendering an empty pane.
  const activeKey =
    selectedKey && d.grouped.some((g) => g.key === selectedKey)
      ? selectedKey
      : null;
  const visibleGroups = activeKey
    ? d.grouped.filter((g) => g.key === activeKey)
    : d.grouped;
  const totalCount = d.rows.length;

  return (
    <div className="flex flex-col gap-4 p-6 max-w-5xl mx-auto w-full">
      <header className="space-y-2">
        <h1 className="typo-h3 text-foreground/95 inline-flex items-center gap-2">
          <ScrollText className="w-5 h-5 text-fuchsia-400" />
          {t.plugins.companion.decisions_panel_title}
        </h1>
        <p className="typo-body text-foreground leading-relaxed">
          {t.plugins.companion.decisions_panel_subtitle}
        </p>
      </header>

      {d.showScopeBanner && d.scopedIntent && (
        <ScopeBanner intent={d.scopedIntent} onShowAll={d.handleShowAll} />
      )}

      <DecisionsFilterInput value={d.filter} onChange={d.setFilter} />

      {d.loading && <DecisionsLoadingRow />}
      {!d.loading && d.error && <DecisionsErrorRow message={d.error} />}
      {!d.loading && !d.error && d.rows.length === 0 && (
        <DecisionsEmpty
          filtered={d.filter.trim().length > 0}
          onClearFilter={d.handleClearFilter}
          onAskAthena={d.askAthenaToLogDecision}
        />
      )}

      {!d.loading && d.rows.length > 0 && (
        <div className="flex items-start gap-6">
          {/* Context rail */}
          <nav
            className="w-56 shrink-0 sticky top-2 space-y-0.5"
            aria-label={t.plugins.companion.decisions_atlas_contexts}
          >
            <div className="flex items-center gap-1.5 px-2 pb-2">
              <Layers className="w-3.5 h-3.5 text-fuchsia-400" />
              <span className="typo-label text-foreground">
                {t.plugins.companion.decisions_atlas_contexts}
              </span>
            </div>
            <RailItem
              label={t.plugins.companion.decisions_atlas_all_contexts}
              count={totalCount}
              active={activeKey === null}
              onClick={() => setSelectedKey(null)}
            />
            {d.grouped.map((g) => (
              <RailItem
                key={g.key}
                label={g.label}
                count={g.items.length}
                active={activeKey === g.key}
                onClick={() => setSelectedKey(g.key)}
              />
            ))}
          </nav>

          {/* Reading pane */}
          <div className="flex-1 min-w-0 space-y-8">
            {visibleGroups.map((group) => (
              <ContextThread key={group.key} group={group} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function RailItem({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-interactive border-l-2 text-left transition-colors focus-ring ${
        active
          ? 'border-l-fuchsia-400 bg-fuchsia-500/10 text-foreground'
          : 'border-l-transparent text-foreground hover:bg-foreground/[0.05]'
      }`}
    >
      <span className="typo-body truncate flex-1">{label}</span>
      <span className={`typo-caption shrink-0${active ? ' text-fuchsia-300' : ''}`}>
        {count}
      </span>
    </button>
  );
}

function ContextThread({ group }: { group: DecisionGroup }) {
  return (
    <section data-context-key={group.key}>
      <h2 className="typo-title truncate mb-3">{group.label}</h2>
      <ol className="relative space-y-6 pl-5 border-l border-fuchsia-500/20">
        {group.items.map((row) => (
          <li
            key={row.id}
            data-decision-id={row.id}
            className="relative space-y-1.5"
          >
            <span
              aria-hidden
              className="absolute -left-[27px] top-1.5 w-2.5 h-2.5 rounded-full bg-fuchsia-500/50 ring-2 ring-fuchsia-500/20"
            />
            <div className="flex items-baseline justify-between gap-3">
              <span className="typo-label text-fuchsia-300/90 min-w-0 truncate">
                {row.label}
              </span>
              <RelativeTime
                timestamp={row.decisionTimestamp ?? row.createdAt}
                className="typo-caption shrink-0"
              />
            </div>
            <div className="typo-title-lg">{row.choice}</div>
            <p className="typo-body text-foreground leading-relaxed">
              {row.rationale}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}
