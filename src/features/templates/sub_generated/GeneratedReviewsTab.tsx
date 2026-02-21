import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  FlaskConical,
  Play,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  Lightbulb,
  Download,
  MoreVertical,
  Trash2,
  Workflow,
  Sparkles,
} from 'lucide-react';
import { getConnectorMeta, ConnectorIcon } from '@/features/shared/components/ConnectorMeta';
import { ReviewExpandedDetail } from '@/features/overview/sub_manual-review/ReviewExpandedDetail';
import { usePersonaStore } from '@/stores/personaStore';
import { deriveConnectorReadiness } from './ConnectorReadiness';
import { ADOPT_CONTEXT_KEY } from './useAdoptReducer';
import AdoptionWizardModal from './AdoptionWizardModal';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import type { UseCaseFlow } from '@/lib/types/frontendTypes';
import type { DesignAnalysisResult } from '@/lib/types/designTypes';
import type { CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';

function parseJsonSafe<T>(json: string | null, fallback: T): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
}

function getQualityScore(review: PersonaDesignReview): number | null {
  if (review.structural_score === null && review.semantic_score === null) return null;
  if (review.structural_score !== null && review.semantic_score !== null) {
    return Math.round((review.structural_score + review.semantic_score) / 2);
  }
  return review.structural_score ?? review.semantic_score;
}

function getQualityColor(score: number): string {
  if (score >= 80) return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
  if (score >= 60) return 'text-amber-400 bg-amber-500/10 border-amber-500/20';
  return 'text-red-400 bg-red-500/10 border-red-500/20';
}

function RowActionMenu({ reviewId, onDelete }: { reviewId: string; onDelete: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [open]);

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen((prev) => !prev);
        }}
        className="p-1 rounded-md opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-secondary/60 transition-all"
        aria-label="Row actions"
        aria-haspopup="true"
        aria-expanded={open}
      >
        <MoreVertical className="w-4 h-4 text-muted-foreground/50" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 min-w-[150px] py-1 bg-background border border-primary/20 rounded-lg shadow-2xl backdrop-blur-sm">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              onDelete(reviewId);
            }}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors text-left"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete template
          </button>
        </div>
      )}
    </div>
  );
}

interface Props {
  reviews: PersonaDesignReview[];
  isLoading: boolean;
  isRunning: boolean;
  expandedRow: string | null;
  setExpandedRow: (id: string | null) => void;
  selectedPersonaId: string | null;
  startNewReview: (personaId?: string, testCases?: Array<{ id: string; name: string; instruction: string }>) => void;
  connectorFilter: string[];
  onContextMenu: (e: React.MouseEvent, reviewId: string) => void;
  onDelete: (id: string) => void;
  onViewFlows: (review: PersonaDesignReview) => void;
  handleStartReview: () => void;
  credentials?: CredentialMetadata[];
  connectorDefinitions?: ConnectorDefinition[];
  onPersonaCreated?: () => void;
}

export default function GeneratedReviewsTab({
  reviews,
  isLoading,
  isRunning,
  expandedRow,
  setExpandedRow,
  selectedPersonaId,
  startNewReview,
  connectorFilter,
  onContextMenu,
  onDelete,
  onViewFlows,
  handleStartReview,
  credentials = [],
  connectorDefinitions = [],
  onPersonaCreated,
}: Props) {
  const templateAdoptActive = usePersonaStore((s) => s.templateAdoptActive);
  const [adoptWizardReview, setAdoptWizardReview] = useState<PersonaDesignReview | null>(null);

  const installedConnectorNames = useMemo(
    () => new Set(connectorDefinitions.map((c) => c.name)),
    [connectorDefinitions],
  );
  const credentialServiceTypes = useMemo(
    () => new Set(credentials.map((c) => c.service_type)),
    [credentials],
  );

  const sortedReviews = React.useMemo(() => {
    let filtered = [...reviews];

    // Apply connector filter
    if (connectorFilter.length > 0) {
      filtered = filtered.filter((review) => {
        const connectors: string[] = parseJsonSafe(review.connectors_used, []);
        return connectorFilter.some((c) => connectors.includes(c));
      });
    }

    return filtered.sort((a, b) => a.test_case_name.localeCompare(b.test_case_name));
  }, [reviews, connectorFilter]);

  const handleAdoptClick = (review: PersonaDesignReview) => {
    setAdoptWizardReview(review);
  };

  if (isLoading && reviews.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground/40 text-sm">
        Loading templates...
      </div>
    );
  }

  if (reviews.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground/40">
        <FlaskConical className="w-12 h-12 opacity-30" />
        <p className="text-sm font-medium">No generated templates yet</p>
        <p className="text-xs text-muted-foreground/30 text-center max-w-xs">
          Generate templates to build a library of reusable persona configurations
        </p>
        <button
          onClick={handleStartReview}
          disabled={isRunning}
          className="px-4 py-2 text-sm rounded-xl bg-violet-500/15 text-violet-300 border border-violet-500/25 hover:bg-violet-500/25 transition-colors flex items-center gap-2"
        >
          <Play className="w-3.5 h-3.5" />
          Generate Templates
        </button>
      </div>
    );
  }

  // Re-open the wizard to show background progress (no specific review needed — it restores from localStorage)
  const handleResumeAdoption = () => {
    // Try to find the matching review from persisted context
    try {
      const raw = window.localStorage.getItem(ADOPT_CONTEXT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { templateName?: string };
        const match = reviews.find((r) => r.test_case_name === parsed.templateName);
        if (match) {
          setAdoptWizardReview(match);
          return;
        }
      }
    } catch { /* ignore */ }
    // Fallback: open wizard with first review (restoration will override from localStorage)
    if (reviews[0]) setAdoptWizardReview(reviews[0]);
  };

  return (
    <>
      {/* Background adoption banner */}
      {templateAdoptActive && !adoptWizardReview && (
        <div className="mx-4 mt-3 mb-2">
          <button
            onClick={handleResumeAdoption}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-violet-500/8 border border-violet-500/15 hover:bg-violet-500/12 transition-colors text-left"
          >
            <div className="w-7 h-7 rounded-lg bg-violet-500/15 flex items-center justify-center flex-shrink-0">
              <Sparkles className="w-4 h-4 text-violet-400 animate-pulse" />
            </div>
            <div className="flex-1 min-w-0">
              <span className="text-xs font-medium text-violet-300 block">Template adoption in progress</span>
              <span className="text-[11px] text-muted-foreground/40">Click to view progress</span>
            </div>
            <div className="w-2 h-2 rounded-full bg-violet-400 animate-pulse flex-shrink-0" />
          </button>
        </div>
      )}

      <table className="w-full">
        <thead className="sticky top-0 z-10">
          <tr className="bg-background border-b border-primary/10" style={{ backgroundColor: 'hsl(var(--background))' }}>
            <th className="text-left text-xs font-medium text-muted-foreground/50 px-6 py-3 w-8 bg-secondary/80" />
            <th className="text-left text-xs font-medium text-muted-foreground/50 px-4 py-3 bg-secondary/80">Template Name</th>
            <th className="text-left text-xs font-medium text-muted-foreground/50 px-4 py-3 bg-secondary/80">Connectors</th>
            <th className="text-center text-xs font-medium text-muted-foreground/50 px-4 py-3 bg-secondary/80">Quality</th>
            <th className="text-center text-xs font-medium text-muted-foreground/50 px-4 py-3 bg-secondary/80">Status</th>
            <th className="text-center text-xs font-medium text-muted-foreground/50 px-4 py-3 bg-secondary/80">Flows</th>
            <th className="text-right text-xs font-medium text-muted-foreground/50 px-6 py-3 w-28 bg-secondary/80" />
          </tr>
        </thead>
        <tbody>
          {sortedReviews.map((review) => {
            const isExpanded = expandedRow === review.id;
            const connectors: string[] = parseJsonSafe(review.connectors_used, []);
            const qualityScore = getQualityScore(review);
            const flows = parseJsonSafe<UseCaseFlow[]>(review.use_case_flows, []);
            const designResult = parseJsonSafe<DesignAnalysisResult | null>(review.design_result, null);

            // Derive readiness from design result
            const readinessStatuses = designResult?.suggested_connectors
              ? deriveConnectorReadiness(designResult.suggested_connectors, installedConnectorNames, credentialServiceTypes)
              : [];

            const statusBadge = {
              passed: { Icon: CheckCircle2, color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20', label: 'pass' },
              failed: { Icon: XCircle, color: 'text-red-400 bg-red-500/10 border-red-500/20', label: 'fail' },
              error: { Icon: AlertTriangle, color: 'text-amber-400 bg-amber-500/10 border-amber-500/20', label: 'error' },
            }[review.status] || { Icon: Clock, color: 'text-muted-foreground bg-secondary/30 border-primary/10', label: review.status };

            const StatusIcon = statusBadge.Icon;

            return (
              <React.Fragment key={review.id}>
                <tr
                  onClick={() => setExpandedRow(isExpanded ? null : review.id)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    onContextMenu(e, review.id);
                  }}
                  className="group border-b border-primary/5 hover:bg-secondary/30 cursor-pointer transition-colors"
                >
                  <td className="px-6 py-3">
                    {isExpanded ? (
                      <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/40" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/40" />
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div>
                      <span className="text-sm font-medium text-foreground/80 block">
                        {review.test_case_name}
                      </span>
                      <span className="text-xs text-muted-foreground/40 block truncate max-w-[400px]">
                        {review.instruction.length > 80
                          ? review.instruction.slice(0, 80) + '...'
                          : review.instruction}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {connectors.map((c) => {
                        const meta = getConnectorMeta(c);
                        const status = readinessStatuses.find((s) => s.connector_name === c);
                        const isReady = status?.health === 'ready';
                        return (
                          <div
                            key={c}
                            className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 transition-opacity ${
                              isReady ? '' : 'opacity-30 grayscale'
                            }`}
                            style={{ backgroundColor: `${meta.color}18` }}
                            title={`${meta.label}${isReady ? '' : ' (not configured)'}`}
                          >
                            <ConnectorIcon meta={meta} size="w-4 h-4" />
                          </div>
                        );
                      })}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {qualityScore !== null ? (
                      <span
                        className={`inline-flex items-center px-2.5 py-1 text-xs font-mono font-semibold rounded-full border ${getQualityColor(qualityScore)}`}
                      >
                        {qualityScore}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground/30">--</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex items-center justify-center gap-1.5">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-1 text-xs rounded-full border ${statusBadge.color}`}
                      >
                        <StatusIcon className="w-3 h-3" />
                        {statusBadge.label}
                      </span>
                      {review.suggested_adjustment && (
                        <span title="Adjustment suggestion available">
                          <Lightbulb className="w-3.5 h-3.5 text-amber-400/60" />
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {flows.length > 0 ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onViewFlows(review);
                        }}
                        className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-lg bg-violet-500/10 text-violet-300 border border-violet-500/20 hover:bg-violet-500/20 transition-colors"
                      >
                        <Workflow className="w-3 h-3" />
                        {flows.length}
                      </button>
                    ) : (
                      <span className="text-xs text-muted-foreground/30">--</span>
                    )}
                  </td>
                  <td className="px-6 py-3 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAdoptClick(review);
                        }}
                        className="px-3 py-1.5 text-xs rounded-lg bg-violet-500/15 text-violet-300 border border-violet-500/25 hover:bg-violet-500/25 transition-colors inline-flex items-center gap-1.5"
                      >
                        <Download className="w-3 h-3" />
                        Adopt
                      </button>
                      <RowActionMenu reviewId={review.id} onDelete={onDelete} />
                    </div>
                  </td>
                </tr>
                {isExpanded && (
                  <tr>
                    <td colSpan={7} className="px-6 py-4 bg-secondary/20 border-b border-primary/10">
                      <ReviewExpandedDetail
                        review={review}
                        isRunning={isRunning}
                        onApplyAdjustment={(adjustedInstruction) => {
                          startNewReview(selectedPersonaId ?? undefined, [
                            { id: review.id, name: review.test_case_name, instruction: adjustedInstruction },
                          ]);
                          setExpandedRow(null);
                        }}
                        onAdopt={() => handleAdoptClick(review)}
                        isAdopting={false}
                        onViewDiagram={() => onViewFlows(review)}
                      />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>

      {/* Adoption Wizard Modal */}
      <AdoptionWizardModal
        isOpen={!!adoptWizardReview}
        onClose={() => setAdoptWizardReview(null)}
        review={adoptWizardReview}
        credentials={credentials}
        connectorDefinitions={connectorDefinitions}
        onPersonaCreated={() => {
          setAdoptWizardReview(null);
          onPersonaCreated?.();
        }}
      />
    </>
  );
}
