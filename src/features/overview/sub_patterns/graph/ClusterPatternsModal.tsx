// Leaf-node modal — clicking a cluster (the tree's last level while patterns
// stay off the canvas) opens its patterns as structured cards. The visual
// language is mined from the triage deck's TriageCard/MetricBadgeRow/Block
// idiom (rounded-card border-2 object, labelled section blocks, pill badges
// straddling the top edge) rather than re-invented — a pattern here and a
// pattern under review should read as the same species.
import { ArrowUpRight, BookmarkCheck, BookmarkPlus, Link2 } from 'lucide-react';

import { BaseModal } from '@/lib/ui/BaseModal';
import { useTranslation } from '@/i18n/useTranslation';
import type { Translations } from '@/i18n/generated/types';
import { areaTheme } from '../practiceAreaTheme';
import type { KnowledgeItemView } from '../libraryModel';
import type { ClusterNode, RelatedPattern } from './graphModel';

/** Direction-aware label for a typed pattern edge (fabric S2). */
function relLabel(
  w: Translations['plugins']['dev_tools']['workspaces'],
  r: RelatedPattern,
): string {
  switch (r.rel) {
    case 'governs':
      return r.outgoing ? w.graph_rel_governs : w.graph_rel_governed_by;
    case 'prerequisite':
      return r.outgoing ? w.graph_rel_prerequisite_of : w.graph_rel_requires;
    case 'supersedes':
      return r.outgoing ? w.graph_rel_supersedes : w.graph_rel_superseded_by;
    case 'extends':
      return r.outgoing ? w.graph_rel_extends : w.graph_rel_extended_by;
    case 'conflicts_with':
      return w.graph_rel_conflicts_with;
    default:
      return w.graph_rel_composes_with;
  }
}

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

export interface PatternCoverage {
  /** Adherence 0..1 — context-grain when the rollup knows the practice,
   *  matrix-grain resolved share otherwise. */
  pct: number;
  /** e.g. "3 of 35 contexts verified" — present only at context grain. */
  detail?: string;
}

function PatternCard({
  item,
  coverage,
  related,
  inBasket,
  onToggleBasket,
  onOpenRelated,
  onOpen,
}: {
  item: KnowledgeItemView;
  coverage: PatternCoverage | null;
  related: readonly RelatedPattern[];
  inBasket: boolean;
  onToggleBasket?: (item: KnowledgeItemView) => void;
  onOpenRelated?: (otherId: string) => void;
  onOpen?: (item: KnowledgeItemView) => void;
}) {
  const { t, tx } = useTranslation();
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
          <div className="flex items-center gap-2.5 flex-shrink-0">
            {onToggleBasket && (
              <button
                type="button"
                onClick={() => onToggleBasket(item)}
                aria-pressed={inBasket}
                aria-label={inBasket ? w.graph_basket_remove : w.graph_basket_add}
                title={inBasket ? w.graph_basket_remove : w.graph_basket_add}
                className={`transition-colors ${inBasket ? 'text-primary' : 'text-foreground/45 hover:text-foreground'}`}
              >
                {inBasket ? (
                  <BookmarkCheck className="w-4 h-4" aria-hidden />
                ) : (
                  <BookmarkPlus className="w-4 h-4" aria-hidden />
                )}
              </button>
            )}
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
              <span className="typo-label">{w.graph_coverage_label}</span>{' '}
              {Math.round(coverage.pct * 100)}%
              {coverage.detail ? ` · ${coverage.detail}` : ''}
            </span>
          )}
        </div>

        {/* Typed connections (fabric S2) — the relations this pattern carries,
            direction-aware, click-through to the other endpoint. */}
        {related.length > 0 && (
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <Link2 className="w-3 h-3 text-foreground/40 flex-shrink-0" aria-hidden />
            {related.slice(0, 6).map((r, i) => (
              <button
                key={`${r.rel}-${r.otherId}-${i}`}
                type="button"
                onClick={() => onOpenRelated?.(r.otherId)}
                title={r.otherTitle}
                className="typo-caption inline-flex items-center gap-1 rounded-pill border border-border/60 bg-secondary/40 px-2 py-0.5 text-foreground/85 hover:text-foreground hover:bg-secondary/70 transition-colors max-w-[280px]"
              >
                <span className="text-foreground/55">{relLabel(w, r)}</span>
                <span className="truncate">{r.otherTitle}</span>
              </button>
            ))}
            {related.length > 6 && (
              <span className="typo-caption text-foreground/45">
                {tx(w.graph_more, { count: related.length - 6 })}
              </span>
            )}
          </div>
        )}
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
  relatedFor,
  basketIds,
  onToggleBasket,
  onOpenRelated,
  onOpenItem,
  onClose,
}: {
  node: ClusterNode;
  /** Per-pattern coverage; null when there is nothing to trace against. */
  patternCoverage: (item: KnowledgeItemView) => PatternCoverage | null;
  /** Typed connections for one pattern (fabric S2); empty when none. */
  relatedFor: (item: KnowledgeItemView) => readonly RelatedPattern[];
  /** Playbook-draft basket (fabric S3 curator flow). */
  basketIds: ReadonlyMap<string, KnowledgeItemView>;
  onToggleBasket?: (item: KnowledgeItemView) => void;
  onOpenRelated?: (otherId: string) => void;
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
              related={relatedFor(item)}
              inBasket={basketIds.has(item.id)}
              onToggleBasket={onToggleBasket}
              onOpenRelated={onOpenRelated}
              onOpen={onOpenItem}
            />
          ))}
        </div>
      </div>
    </BaseModal>
  );
}
