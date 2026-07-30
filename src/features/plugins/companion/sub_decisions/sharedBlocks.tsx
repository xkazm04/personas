import { ScrollText, Search, Sparkles, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import EmptyState, {
  NoResults,
} from '@/features/shared/components/feedback/ScenarioEmptyState';

/**
 * Presentational fragments shared by the Decisions panel prototype
 * variants — scope banner, filter input, and loading/error/empty states.
 * Hoisted so refinements land once instead of per-variant; the winning
 * variant keeps importing these after consolidation.
 */

export function ScopeBanner({
  intent,
  onShowAll,
}: {
  intent: string;
  onShowAll: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="flex items-start gap-2 rounded-card border border-fuchsia-500/30 bg-fuchsia-500/5 px-3 py-2"
      data-testid="companion-decisions-scope-banner"
    >
      <Sparkles className="w-4 h-4 text-fuchsia-400 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="typo-caption">
          {t.plugins.companion.decisions_panel_currently_designing}
        </div>
        <div className="typo-body text-foreground truncate">{intent}</div>
      </div>
      <button
        type="button"
        onClick={onShowAll}
        className="shrink-0 inline-flex items-center gap-1 typo-caption text-foreground hover:text-foreground/90 rounded-interactive px-1.5 py-0.5 hover:bg-foreground/[0.06] focus-ring transition-colors"
        data-testid="companion-decisions-show-all"
      >
        <X className="w-3 h-3" />
        {t.plugins.companion.decisions_panel_show_all}
      </button>
    </div>
  );
}

export function DecisionsFilterInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="relative">
      <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-foreground" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t.plugins.companion.decisions_panel_filter_placeholder}
        className="w-full pl-8 pr-3 py-1.5 rounded-input bg-secondary/50 border border-foreground/15 typo-body text-foreground focus-ring"
        data-testid="companion-decisions-filter"
      />
    </div>
  );
}

const GHOST_BAR = 'rounded bg-primary/[0.06]';
const GHOST_TITLE_WIDTHS = ['w-48', 'w-36', 'w-40', 'w-32', 'w-44'];

/**
 * Cold-load ghost for the Atlas layout (docs/design/overview-loading.md §C):
 * a rail-shaped column of bars beside a reading-pane-shaped block, so the
 * swap to real content doesn't shift geometry. Only rendered when the fetch
 * is in flight AND nothing is on screen yet (see DecisionsPanel) — a
 * refetch that already has rows keeps showing them, per law 1.
 */
export function DecisionsGhostRows() {
  return (
    <div className="flex items-start gap-6" aria-hidden="true">
      <div className="w-56 shrink-0 space-y-1.5">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="px-2.5 py-1.5 animate-fade-in"
            style={{ animationDelay: `${120 + i * 35}ms` }}
          >
            <span className={`block h-3.5 w-2/3 ${GHOST_BAR}`} />
          </div>
        ))}
      </div>
      <div className="flex-1 min-w-0 space-y-6">
        {Array.from({ length: 3 }).map((_, i) => {
          const titleW = GHOST_TITLE_WIDTHS[i % GHOST_TITLE_WIDTHS.length];
          const delay = `${120 + i * 35}ms`;
          return (
            <div key={i} className="space-y-1.5 animate-fade-in" style={{ animationDelay: delay }}>
              <span className={`block h-3 ${titleW} max-w-full ${GHOST_BAR}`} />
              <span className={`block h-4 w-3/4 ${GHOST_BAR}`} />
              <span className={`block h-3 w-full ${GHOST_BAR}`} />
              <span className={`block h-3 w-5/6 ${GHOST_BAR}`} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function DecisionsErrorRow({ message }: { message: string }) {
  return (
    <div className="rounded-card border border-rose-500/30 bg-rose-500/10 px-3 py-2 typo-caption text-rose-400">
      {message}
    </div>
  );
}

/** Empty state pair: filtered (NoResults + reset) vs truly empty (CTA that
 *  opens Athena's chat with the log-a-decision prompt). */
export function DecisionsEmpty({
  filtered,
  onClearFilter,
  onAskAthena,
}: {
  filtered: boolean;
  onClearFilter: () => void;
  onAskAthena: () => void;
}) {
  const { t } = useTranslation();
  if (filtered) {
    return (
      <NoResults
        onReset={onClearFilter}
        subtitle={t.plugins.companion.decisions_panel_empty_filtered}
      />
    );
  }
  return (
    <EmptyState
      icon={ScrollText}
      iconColor="text-fuchsia-400/80"
      iconContainerClassName="bg-fuchsia-500/10 border-fuchsia-500/20"
      title={t.plugins.companion.decisions_panel_empty_title}
      subtitle={t.plugins.companion.decisions_panel_empty}
      action={{
        label: t.plugins.companion.decisions_panel_empty_cta,
        onClick: onAskAthena,
        icon: Sparkles,
      }}
    />
  );
}
