import { ScrollText } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useDesignDecisions } from './useDesignDecisions';
import {
  DecisionsEmpty,
  DecisionsErrorRow,
  DecisionsFilterInput,
  DecisionsLoadingRow,
  ScopeBanner,
} from './sharedBlocks';

/**
 * Variant: Ledger — engineering decision-record aesthetic.
 *
 * Mental model: a numbered ledger of decision records. Where the baseline
 * compresses label → choice → timestamp onto one cramped line with the
 * rationale as low-contrast caption text, the Ledger gives every decision
 * a discrete card with one reading order: an uppercase kicker naming what
 * was decided about, the chosen option as a full-contrast headline, then
 * the rationale as readable body text under a hairline. Context groups get
 * sticky band headers with entry counts so long retrospectives stay
 * navigable mid-scroll.
 */
export default function DecisionsVariantLedger() {
  const { t } = useTranslation();
  const d = useDesignDecisions();

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
        <div className="space-y-6">
          {d.grouped.map((group) => (
            <section key={group.key} data-context-key={group.key}>
              {/* Sticky context band — survives the scroll so the reader
                  always knows which persona context they're inside. */}
              <div className="sticky top-0 z-10 -mx-2 px-2 py-2 bg-background/90 backdrop-blur-sm">
                <div className="flex items-center gap-2.5">
                  <span
                    aria-hidden
                    className="w-1.5 h-4 rounded-full bg-fuchsia-400/70 shrink-0"
                  />
                  <h2 className="typo-data font-semibold text-foreground truncate">
                    {group.label}
                  </h2>
                  <span className="typo-caption text-foreground px-1.5 py-0.5 rounded-full bg-foreground/[0.06] border border-foreground/10 shrink-0">
                    {group.items.length}
                  </span>
                  <div className="flex-1 h-px bg-foreground/10" />
                </div>
              </div>

              <div className="space-y-2 mt-2">
                {group.items.map((row, idx) => (
                  <article
                    key={row.id}
                    data-decision-id={row.id}
                    className="rounded-card border border-foreground/10 border-l-2 border-l-fuchsia-500/40 bg-secondary/30 hover:border-foreground/20 hover:border-l-fuchsia-400/70 transition-colors p-4"
                  >
                    <div className="flex items-baseline gap-3">
                      <span className="typo-label text-fuchsia-300/90 min-w-0 truncate">
                        {row.label}
                      </span>
                      <span
                        aria-hidden
                        className="typo-code text-[11px] text-foreground shrink-0"
                      >
                        {String(idx + 1).padStart(2, '0')}
                      </span>
                      <RelativeTime
                        timestamp={row.decisionTimestamp ?? row.createdAt}
                        className="typo-caption text-foreground ml-auto shrink-0"
                      />
                    </div>
                    <div className="typo-body-lg font-medium text-foreground mt-1.5">
                      {row.choice}
                    </div>
                    <p className="typo-body text-foreground leading-relaxed mt-2.5 pt-2.5 border-t border-foreground/[0.06]">
                      {row.rationale}
                    </p>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
