import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  ShieldCheck,
  Sparkles,
  Workflow,
} from 'lucide-react';
import { highlightMatch } from '@/lib/ui/highlightMatch';
import { deriveConnectorReadiness } from '../../shared/ConnectorReadiness';
import { readinessTier } from '../../shared/adoptionReadiness';
import { RowActionMenu } from './RowActionMenu';
import { ArchCategoryIcons } from './ArchCategoryIcons';
import { ExpandedRowContent } from '../matrix/ExpandedRowContent';
import { getCachedLightFields, getCachedDesignResult } from './reviewParseCache';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import type { TemplateModal } from './reviewParseCache';
import type { ModalStackActions } from '../modals/useModalStack';

interface ComfortableRowProps {
  review: PersonaDesignReview;
  isExpanded: boolean;
  readinessScore: number;
  searchQuery: string;
  isAiResult: boolean;
  installedConnectorNames: Set<string>;
  credentialServiceTypes: Set<string>;
  modals: ModalStackActions<TemplateModal>;
  onToggleExpand: (id: string) => void;
  onViewFlows: (review: PersonaDesignReview) => void;
  onDeleteReview: (id: string) => void;
  onAddCredential: (name: string, review: PersonaDesignReview) => void;
  rebuildReviewId: string | null;
  rebuildPhase: string;
  onResetRebuild: () => void;
  previewReviewId: string | null;
  previewPhase: string;
  onResetPreview: () => void;
}

export function ComfortableRow({
  review,
  isExpanded,
  readinessScore,
  searchQuery,
  isAiResult,
  installedConnectorNames,
  credentialServiceTypes,
  modals,
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
}: ComfortableRowProps) {
  const { connectors, flowCount } = getCachedLightFields(review);
  const designResult = isExpanded ? getCachedDesignResult(review) : null;

  const readinessStatuses = designResult?.suggested_connectors
    ? deriveConnectorReadiness(designResult.suggested_connectors, installedConnectorNames, credentialServiceTypes)
    : [];

  const allConnectorsReady = isExpanded && connectors.length > 0 && connectors.every((c) => {
    const status = readinessStatuses.find((s) => s.connector_name === c);
    return status?.health === 'ready';
  });

  return (
    <>
      <div
        onClick={() => onToggleExpand(review.id)}
        className="group flex items-center border-b border-primary/5 hover:bg-secondary/30 cursor-pointer transition-colors"
        data-testid={`template-row-${review.id}`}
      >
        <div className="w-14 px-6 py-4 flex-shrink-0">
          {isExpanded ? (
            <ChevronDown className="w-4.5 h-4.5 text-muted-foreground/80" />
          ) : (
            <ChevronRight className="w-4.5 h-4.5 text-muted-foreground/80" />
          )}
        </div>
        <div className="flex-1 px-4 py-4 min-w-0">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-base font-semibold text-foreground/80">
                  {highlightMatch(review.test_case_name, searchQuery)}
                </span>
                {isAiResult && (
                  <span className="px-1.5 py-0.5 text-sm rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/20 flex-shrink-0">
                    <Sparkles className="w-2.5 h-2.5 inline -mt-px mr-0.5" />AI
                  </span>
                )}
                {review.adoption_count > 0 && (
                  <span
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 text-sm font-mono rounded bg-emerald-500/10 text-emerald-400/70 border border-emerald-500/15"
                    title={`Adopted ${review.adoption_count} time${review.adoption_count !== 1 ? 's' : ''}`}
                  >
                    <Download className="w-2.5 h-2.5" />
                    {review.adoption_count}
                  </span>
                )}
                <span
                  className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-sm font-mono rounded border flex-shrink-0 ${readinessTier(readinessScore).bgClass}`}
                  title={`${readinessScore}% of connectors ready`}
                >
                  {readinessScore === 100 ? (
                    <CheckCircle2 className="w-2.5 h-2.5" />
                  ) : (
                    <ShieldCheck className="w-2.5 h-2.5" />
                  )}
                  {readinessScore}% ready
                </span>
                {flowCount > 0 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onViewFlows(review);
                    }}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 text-sm rounded bg-violet-500/10 text-violet-400/70 border border-violet-500/15 hover:bg-violet-500/20 transition-colors flex-shrink-0"
                    title="View flows"
                  >
                    <Workflow className="w-2.5 h-2.5" />
                    {flowCount} flow{flowCount !== 1 ? 's' : ''}
                  </button>
                )}
              </div>
              {/* Second line: instruction */}
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-sm text-muted-foreground/60 truncate flex-1 min-w-0">
                  {review.instruction.length > 80
                    ? review.instruction.slice(0, 80) + '...'
                    : review.instruction}
                </span>
              </div>
            </div>
            <ArchCategoryIcons connectors={connectors} credentialServiceTypes={credentialServiceTypes} />
          </div>
        </div>
        <div className="w-28 px-4 py-4 flex-shrink-0">
          <div className="flex justify-center">
            {review.adoption_count > 0 ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-300">
                <Download className="w-3.5 h-3.5" />
                {review.adoption_count}
              </span>
            ) : (
              <span className="text-sm text-muted-foreground/60">--</span>
            )}
          </div>
        </div>
        <div className="w-12 px-3 py-4 flex-shrink-0">
          <div className="flex items-center justify-end">
            <RowActionMenu
              reviewId={review.id}
              onDelete={onDeleteReview}
              onViewDetails={() => modals.open({ type: 'detail', review })}
              onRebuild={() => {
                if (rebuildReviewId !== review.id || rebuildPhase === 'completed' || rebuildPhase === 'failed') {
                  onResetRebuild();
                }
                modals.open({ type: 'rebuild', review });
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
            onAdopt={() => modals.open({ type: 'adopt', review })}
            onTryIt={() => {
              if (previewReviewId !== review.id || previewPhase === 'completed' || previewPhase === 'failed') {
                onResetPreview();
              }
              modals.open({ type: 'preview', review });
            }}
            onAddCredential={(name) => onAddCredential(name, review)}
          />
        </div>
      )}
    </>
  );
}
