// Leaf-node modal — clicking a cluster (the tree's last level while patterns
// stay off the canvas) opens its patterns as structured cards. The visual
// language is mined from the triage deck's TriageCard/MetricBadgeRow/Block
// idiom (rounded-card border-2 object, labelled section blocks, pill badges
// straddling the top edge) rather than re-invented — a pattern here and a
// pattern under review should read as the same species.
import { ArrowUpRight } from 'lucide-react';

import { BaseModal } from '@/lib/ui/BaseModal';
import { useTranslation } from '@/i18n/useTranslation';
import { areaTheme } from '../practiceAreaTheme';
import type { KnowledgeItemView } from '../libraryModel';
import type { ClusterNode } from './graphModel';

/** Pill badge in the MetricBadgeRow idiom: label + value, floating on the
 *  card's top edge. */
function FactPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5 rounded-pill border border-border/70 bg-background px-2.5 py-1 shadow-elevation-2">
      <span className="typo-label text-muted-foreground">{label}</span>
      <span className="typo-label text-foreground tabular-nums">{value}</span>
    </div>
  );
}

function PatternCard({
  item,
  coverage,
  onOpen,
}: {
  item: KnowledgeItemView;
  coverage: number | null;
  onOpen?: (item: KnowledgeItemView) => void;
}) {
  const { t } = useTranslation();
  const w = t.plugins.dev_tools.workspaces;
  const adopted = item.status === 'adopted';

  return (
    <div className="relative mt-3">
      <div
        className={`rounded-card border-2 bg-background shadow-elevation-2 px-4 pb-3 pt-4 ${
          adopted ? 'border-status-success/25' : 'border-border/70'
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <h3 className="typo-body font-medium text-foreground">{item.title}</h3>
          {onOpen && (
            <button
              type="button"
              onClick={() => onOpen(item)}
              className="typo-label flex items-center gap-1 text-primary hover:text-primary/80 whitespace-nowrap transition-colors"
            >
              {w.graph_open_detail}
              <ArrowUpRight className="w-3.5 h-3.5" aria-hidden />
            </button>
          )}
        </div>

        {/* The statement — the distilled move a session should act on. */}
        <section className="mt-2 rounded-card border border-primary/12 bg-secondary/25 px-3 py-2.5">
          <p className="typo-body text-foreground">{item.statement}</p>
        </section>

        {/* Metadata ledger — machine axes rendered as-is (the ledger's own
            convention for taxonomy tokens), human axes through i18n. */}
        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <span className="typo-caption text-muted-foreground">
            <span className="typo-label">{w.col_kind}</span> {item.kind}
          </span>
          {item.ftype && (
            <span className="typo-caption text-muted-foreground">
              <span className="typo-label">{w.col_ftype}</span> {item.ftype}
            </span>
          )}
          {item.abstraction && (
            <span className="typo-caption text-muted-foreground">
              <span className="typo-label">{w.col_altitude}</span> {item.abstraction}
            </span>
          )}
          {typeof item.confidence === 'number' && (
            <span className="typo-caption text-muted-foreground tabular-nums">
              <span className="typo-label">{w.col_confidence}</span> {Math.round(item.confidence * 100)}%
            </span>
          )}
          {coverage !== null && (
            <span className="typo-caption text-muted-foreground tabular-nums">
              <span className="typo-label">{w.graph_coverage_label}</span> {Math.round(coverage * 100)}%
            </span>
          )}
        </div>
      </div>

      {/* Facts straddle the card's top edge, MetricBadgeRow-style. */}
      <div className="pointer-events-none absolute -top-3 left-3 right-3 flex items-center gap-2">
        <span
          className={`inline-block w-2 h-2 rounded-full shadow-elevation-1 ${
            adopted ? 'bg-status-success' : 'bg-status-warning'
          }`}
          aria-hidden
        />
        {typeof item.evidenceCount === 'number' && item.evidenceCount > 0 && (
          <FactPill label={w.col_evidence} value={`×${item.evidenceCount}`} />
        )}
      </div>
    </div>
  );
}

export function ClusterPatternsModal({
  node,
  patternCoverage,
  onOpenItem,
  onClose,
}: {
  node: ClusterNode;
  /** Per-pattern resolved share (adopted or skipped-as-inapplicable), 0..1;
   *  null when there is nothing to trace against (no member projects). */
  patternCoverage: (item: KnowledgeItemView) => number | null;
  onOpenItem?: (item: KnowledgeItemView) => void;
  onClose: () => void;
}) {
  const { t, tx } = useTranslation();
  const w = t.plugins.dev_tools.workspaces;
  const theme = areaTheme(node.topic);

  return (
    <BaseModal isOpen onClose={onClose} titleId="cluster-patterns" size="xl" staggerChildren={false}>
      <div className="flex flex-col min-h-0 max-h-[78vh]">
        <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-3 border-b border-border/60">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className={`typo-label px-1.5 py-0.5 rounded-interactive ${theme.chip}`}>
              {node.topic}
            </span>
            <h2 id="cluster-patterns" className="typo-section-title text-foreground truncate">
              {node.cluster}
            </h2>
          </div>
          <div className="flex items-center gap-3 typo-caption text-foreground/70 flex-shrink-0">
            <span className="text-foreground typo-data-md tabular-nums">{node.count}</span>
            <span>{w.graph_practices}</span>
            {node.pending > 0 && (
              <span className="text-status-warning tabular-nums">
                {tx(w.graph_pending_count, { count: node.pending })}
              </span>
            )}
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-5 pt-1">
          {node.items.map((item) => (
            <PatternCard
              key={item.id}
              item={item}
              coverage={patternCoverage(item)}
              onOpen={onOpenItem}
            />
          ))}
        </div>
      </div>
    </BaseModal>
  );
}
