import { onRowActivateKey } from './rowActivation';
import { memo, useCallback } from 'react';
import {
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Download,
  Sparkles,
  Square,
  Workflow,
} from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { isCliRunSettled, type CliRunPhase } from '@/hooks/execution/useCorrelatedCliStream';
import { highlightMatch } from '@/lib/ui/highlightMatch';
import { resolveConnectorStatuses } from '../../shared/useConnectorReadiness';
import type { ConnectorReadinessMap } from '../../shared/useConnectorReadiness';
import { RowActionMenu } from './RowActionMenu';
import { ArchCategoryIcons } from './ArchCategoryIcons';
import { TemplateCategoryPills } from './TemplateCategoryPills';
import { ExpandedRowContent } from './ExpandedRowContent';
import { getCachedLightFields, getCachedDesignResult } from './reviewParseCache';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import type { TemplateModal } from './reviewParseCache';

interface ComfortableRowProps {
  review: PersonaDesignReview;
  isExpanded: boolean;
  searchQuery: string;
  isAiResult: boolean;
  credentialServiceTypes: Set<string>;
  /** Authoritative per-connector verdicts, resolved once for the whole gallery. */
  connectorReadiness: ConnectorReadinessMap;
  /** `modals.open` itself (stable), not the stack object, which is a new
   *  object on every gallery render and would defeat the row memo. */
  openModal: (entry: TemplateModal) => void;
  // Takes (id, currentIsExpanded) so parents can pass a stable reference
  // without per-row closures. The row itself constructs the call inside
  // a memoized handler.
  onToggleExpand: (id: string, isExpanded: boolean) => void;
  onViewFlows: (review: PersonaDesignReview) => void;
  onDeleteReview: (id: string) => void;
  onAddCredential: (name: string, review: PersonaDesignReview) => void;
  rebuildReviewId: string | null;
  rebuildPhase: string;
  onResetRebuild: () => void;
  previewReviewId: string | null;
  previewPhase: CliRunPhase;
  onResetPreview: () => void;
  isCompareSelected: boolean;
  compareDisabled: boolean;
  onToggleCompare: (review: PersonaDesignReview) => void;
}

function ComfortableRowImpl({
  review,
  isExpanded,
  searchQuery,
  isAiResult,
  credentialServiceTypes,
  connectorReadiness,
  openModal,
  onToggleExpand,
  onViewFlows,
  onDeleteReview,
  onAddCredential,
  rebuildReviewId,
  rebuildPhase,
  onResetRebuild,
  previewReviewId,
  previewPhase,
  onResetPreview,
  isCompareSelected,
  compareDisabled,
  onToggleCompare,
}: ComfortableRowProps) {
  const { t, tx } = useTranslation();
  const { connectors, flowCount } = getCachedLightFields(review);
  const designResult = isExpanded ? getCachedDesignResult(review) : null;

  const handleToggle = useCallback(() => {
    onToggleExpand(review.id, isExpanded);
  }, [onToggleExpand, review.id, isExpanded]);

  const readinessStatuses = resolveConnectorStatuses(
    [...connectors, ...(designResult?.suggested_connectors ?? [])],
    connectorReadiness,
  );

  // `every` over the authoritative verdicts: an `unknown` (resolver has not
  // answered yet) is NOT ready, so the adopt affordance never promises a
  // template the run gate would block.
  const allConnectorsReady = isExpanded && connectors.length > 0 && connectors.every((c) => {
    const status = readinessStatuses.find((s) => s.connector_name === c);
    return status?.health === 'ready';
  });

  return (
    <>
      <div
        onClick={handleToggle}
        onKeyDown={onRowActivateKey(handleToggle)}
        tabIndex={0}
        role="button"
        aria-expanded={isExpanded}
        className="group flex items-center border-b border-primary/5 hover:bg-secondary/30 cursor-pointer transition-colors"
        data-testid={`template-row-${review.id}`}
      >
        <div className="w-20 px-4 py-4 flex-shrink-0 flex items-center gap-1.5">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); if (!compareDisabled) onToggleCompare(review); }}
            disabled={compareDisabled}
            aria-pressed={isCompareSelected}
            aria-label={isCompareSelected ? t.templates.compare.remove_from_compare : t.templates.compare.add_to_compare}
            data-testid={`compare-toggle-${review.id}`}
            className={`flex-shrink-0 rounded outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)] ${
              isCompareSelected
                ? 'opacity-100'
                : compareDisabled
                  ? 'opacity-0 group-hover:opacity-30 focus-visible:opacity-30 cursor-not-allowed'
                  : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
            }`}
          >
            {isCompareSelected ? (
              <CheckSquare className="w-4 h-4 text-primary" />
            ) : (
              <Square className="w-4 h-4 text-foreground" />
            )}
          </button>
          {isExpanded ? (
            <ChevronDown className="w-4.5 h-4.5 text-foreground" />
          ) : (
            <ChevronRight className="w-4.5 h-4.5 text-foreground" />
          )}
        </div>
        <div className="flex-1 px-4 py-4 min-w-0">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="typo-body-lg template-name-themed">
                  {highlightMatch(review.test_case_name, searchQuery)}
                </span>
                {isAiResult && (
                  <span className="px-1.5 py-0.5 typo-body rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/20 flex-shrink-0">
                    <Sparkles className="w-2.5 h-2.5 inline -mt-px mr-0.5" />AI
                  </span>
                )}
                {review.adoption_count > 0 && (
                  <Tooltip
                    content={tx(
                      review.adoption_count === 1 ? t.common.adoption_count_one : t.common.adoption_count_other,
                      { count: review.adoption_count },
                    )}
                  >
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 typo-code rounded bg-emerald-500/10 text-emerald-400/70 border border-emerald-500/15">
                      <Download className="w-2.5 h-2.5" />
                      {review.adoption_count}
                    </span>
                  </Tooltip>
                )}
                {flowCount > 0 && (
                  <Tooltip content={`${flowCount} ${t.templates.expanded.flows}`}>
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 typo-body rounded bg-violet-500/10 text-violet-400/70 border border-violet-500/15 flex-shrink-0">
                      <Workflow className="w-2.5 h-2.5" />
                      {flowCount}
                    </span>
                  </Tooltip>
                )}
              </div>
              {/* Second line: instruction (no truncation) */}
              <div className="flex items-center gap-2 mt-0.5">
                <span className="typo-body text-foreground flex-1 min-w-0 line-clamp-3">
                  {review.instruction}
                </span>
              </div>
              {/* Third line: connector category pills. Surfaces the per-template
                  category tags (from connectorCategoryTags + generic slot
                  names) so the reviewer can spot mis-tagged or under-tagged
                  templates during the 107-template category review. */}
              <TemplateCategoryPills
                connectors={connectors}
                className="mt-2"
              />
            </div>
            <ArchCategoryIcons connectors={connectors} credentialServiceTypes={credentialServiceTypes} />
          </div>
        </div>
        <div className="w-28 px-4 py-4 flex-shrink-0">
          <div className="flex justify-center">
            {review.adoption_count > 0 ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 typo-body rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-300">
                <Download className="w-3.5 h-3.5" />
                {review.adoption_count}
              </span>
            ) : (
              <span className="typo-body text-foreground">--</span>
            )}
          </div>
        </div>
        <div className="w-12 px-3 py-4 flex-shrink-0">
          <div className="flex items-center justify-end">
            <RowActionMenu
              reviewId={review.id}
              onDelete={onDeleteReview}
              onViewDetails={() => openModal({ type: 'detail', review })}
              onRebuild={() => {
                if (rebuildReviewId !== review.id || rebuildPhase === 'completed' || rebuildPhase === 'failed') {
                  onResetRebuild();
                }
                openModal({ type: 'rebuild', review });
              }}
            />
          </div>
        </div>
      </div>
      {/* Expanded content -- CSS-only fade-in, no framer-motion */}
      {isExpanded && (
        <div className="border-b border-primary/10 bg-secondary/20 animate-expand-in">
          <ExpandedRowContent
            review={review}
            designResult={designResult}
            allConnectorsReady={allConnectorsReady}
            readinessStatuses={readinessStatuses}
            credentialServiceTypes={credentialServiceTypes}
            onAdopt={() => openModal({ type: 'adopt', review })}
            onTryIt={() => {
              if (previewReviewId !== review.id || isCliRunSettled(previewPhase)) {
                onResetPreview();
              }
              openModal({ type: 'preview', review });
            }}
            onAddCredential={(name) => onAddCredential(name, review)}
            onViewFlows={onViewFlows}
          />
        </div>
      )}
    </>
  );
}

// React.memo wraps the row so a parent re-render that doesn't change this
// row's props skips the subtree. Pairs with useCallback-stabilized handlers
// in TemplateVirtualList + GeneratedReviewsTab.
// /architect 2026-05-17 list-memo-hygiene.
export const ComfortableRow = memo(ComfortableRowImpl);
