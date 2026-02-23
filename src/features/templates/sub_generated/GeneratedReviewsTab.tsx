import React, { useState, useMemo, useRef, useCallback } from 'react';
import { useClickOutside } from '@/hooks/utility/useClickOutside';
import {
  FlaskConical,
  Play,
  Plus,
  Sparkles,
  ChevronDown,
  ChevronRight,
  Download,
  MoreVertical,
  Trash2,
  Eye,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Lightbulb,
  Workflow,
  CircleDot,
  Webhook,
  MousePointerClick,
  Radio,
} from 'lucide-react';
import { getConnectorMeta, ConnectorIcon } from '@/features/shared/components/ConnectorMeta';
import { usePersonaStore } from '@/stores/personaStore';
import { useTemplateGallery } from '@/hooks/design/useTemplateGallery';
import { deleteDesignReview } from '@/api/reviews';
import { deriveConnectorReadiness } from './ConnectorReadiness';
import { TemplateSearchBar } from './TemplateSearchBar';
import { TemplatePagination } from './TemplatePagination';
import { TemplateDetailModal } from './TemplateDetailModal';
import { TemplateAdoptDialog } from './TemplateAdoptDialog';
import { CreateTemplateModal } from './CreateTemplateModal';
import { ADOPT_CONTEXT_KEY } from './useAdoptReducer';
import AdoptionWizardModal from './AdoptionWizardModal';
import { RebuildModal } from './RebuildModal';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import type { DesignAnalysisResult, SuggestedTrigger } from '@/lib/types/designTypes';
import type { UseCaseFlow } from '@/lib/types/frontendTypes';
import type { CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';
import { parseJsonOrDefault as parseJsonSafe } from '@/lib/utils/parseJson';

// ============================================================================
// Helpers
// ============================================================================

function getQualityScore(review: PersonaDesignReview): number | null {
  return review.structural_score ?? review.semantic_score ?? null;
}

function getQualityColor(score: number): string {
  if (score >= 80) return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
  if (score >= 60) return 'text-amber-400 bg-amber-500/10 border-amber-500/20';
  return 'text-red-400 bg-red-500/10 border-red-500/20';
}

const TRIGGER_ICONS: Record<string, typeof Clock> = {
  schedule: Clock,
  webhook: Webhook,
  manual: MousePointerClick,
  polling: Radio,
};

// ============================================================================
// Row Action Menu
// ============================================================================

function RowActionMenu({
  reviewId,
  onDelete,
  onViewDetails,
  onRebuild,
}: {
  reviewId: string;
  onDelete: (id: string) => void;
  onViewDetails: () => void;
  onRebuild: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const closeMenu = useCallback(() => setOpen(false), []);
  useClickOutside(menuRef, open, closeMenu);

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen((prev) => !prev);
        }}
        className="p-1 rounded-md opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-secondary/60 transition-all"
        aria-label="Row actions"
      >
        <MoreVertical className="w-4 h-4 text-muted-foreground/90" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 min-w-[170px] py-1 bg-background border border-primary/20 rounded-lg shadow-2xl backdrop-blur-sm">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              onViewDetails();
            }}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-foreground/80 hover:bg-primary/5 transition-colors text-left"
          >
            <Eye className="w-3.5 h-3.5" />
            View Details
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              onRebuild();
            }}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-blue-400 hover:bg-blue-500/10 transition-colors text-left"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Rebuild
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              onDelete(reviewId);
            }}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 transition-colors text-left"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete template
          </button>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Expanded Row — 3-Column Layout (Use Cases | Connectors | Triggers)
// ============================================================================

function ExpandedRowContent({
  review,
  designResult,
  installedConnectorNames,
  credentialServiceTypes,
  onViewFlows,
  onAdopt,
}: {
  review: PersonaDesignReview;
  designResult: DesignAnalysisResult | null;
  installedConnectorNames: Set<string>;
  credentialServiceTypes: Set<string>;
  onViewFlows: () => void;
  onAdopt: () => void;
}) {
  const flows = parseJsonSafe<UseCaseFlow[]>(review.use_case_flows, []);
  // Fallback: try extracting flows from design_result
  const displayFlows = flows.length > 0
    ? flows
    : (() => {
        const raw = designResult as unknown as Record<string, unknown> | null;
        return raw?.use_case_flows
          ? parseJsonSafe<UseCaseFlow[]>(JSON.stringify(raw.use_case_flows), [])
          : [];
      })();

  const connectors: string[] = parseJsonSafe(review.connectors_used, []);
  const triggerTypes: string[] = parseJsonSafe(review.trigger_types, []);
  const suggestedTriggers: SuggestedTrigger[] = designResult?.suggested_triggers ?? [];

  const readinessStatuses = designResult?.suggested_connectors
    ? deriveConnectorReadiness(designResult.suggested_connectors, installedConnectorNames, credentialServiceTypes)
    : [];

  return (
    <div className="space-y-4">
      {/* Summary */}
      {designResult?.summary && (
        <div className="bg-gradient-to-r from-violet-500/5 to-transparent border border-violet-500/10 rounded-xl px-4 py-3">
          <p className="text-sm text-foreground/90 leading-relaxed">{designResult.summary}</p>
        </div>
      )}

      {/* 3-Column Grid */}
      <div className="grid grid-cols-3 gap-4">
        {/* Use Cases */}
        <div className="bg-secondary/20 rounded-xl border border-primary/8 p-3">
          <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium mb-2 flex items-center gap-1.5">
            <Workflow className="w-3 h-3 text-violet-400/60" />
            Use Cases
          </h4>
          {displayFlows.length > 0 ? (
            <div className="space-y-1.5">
              {displayFlows.map((flow) => (
                <button
                  key={flow.id}
                  onClick={onViewFlows}
                  className="flex items-start gap-1.5 w-full text-left group/flow hover:text-violet-300 transition-colors"
                >
                  <CircleDot className="w-3 h-3 text-violet-400/60 flex-shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <span className="text-xs font-medium text-foreground/80 group-hover/flow:text-violet-300 block truncate">
                      {flow.name}
                    </span>
                    {flow.description && (
                      <span className="text-[10px] text-muted-foreground/50 block truncate">
                        {flow.description}
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground/40 italic">No use case flows defined</p>
          )}
        </div>

        {/* Connectors */}
        <div className="bg-secondary/20 rounded-xl border border-primary/8 p-3">
          <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium mb-2">
            Connectors
          </h4>
          {connectors.length > 0 ? (
            <div className="space-y-1.5">
              {connectors.map((c) => {
                const meta = getConnectorMeta(c);
                const status = readinessStatuses.find((s) => s.connector_name === c);
                const isReady = status?.health === 'ready';
                return (
                  <div key={c} className="flex items-center gap-2">
                    <div
                      className={`w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 transition-opacity ${
                        isReady ? '' : 'opacity-30 grayscale'
                      }`}
                      style={{ backgroundColor: `${meta.color}18` }}
                    >
                      <ConnectorIcon meta={meta} size="w-3.5 h-3.5" />
                    </div>
                    <span className={`text-xs ${isReady ? 'text-foreground/80' : 'text-muted-foreground/50'}`}>
                      {meta.label}
                    </span>
                    {isReady ? (
                      <CheckCircle2 className="w-3 h-3 text-emerald-400/60 ml-auto flex-shrink-0" />
                    ) : (
                      <XCircle className="w-3 h-3 text-red-400/40 ml-auto flex-shrink-0" />
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground/40 italic">No connectors</p>
          )}
        </div>

        {/* Events & Triggers */}
        <div className="bg-secondary/20 rounded-xl border border-primary/8 p-3">
          <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium mb-2">
            Events & Triggers
          </h4>
          {(suggestedTriggers.length > 0 || triggerTypes.length > 0) ? (
            <div className="space-y-1.5">
              {(suggestedTriggers.length > 0
                ? suggestedTriggers
                : triggerTypes.map((t) => ({ trigger_type: t, description: t, config: {} }))
              ).map((trigger, i) => {
                const TriggerIcon = TRIGGER_ICONS[trigger.trigger_type] ?? Clock;
                return (
                  <div key={i} className="flex items-start gap-2">
                    <div className="w-6 h-6 rounded-md bg-blue-500/10 flex items-center justify-center flex-shrink-0">
                      <TriggerIcon className="w-3.5 h-3.5 text-blue-400/60" />
                    </div>
                    <div className="min-w-0">
                      <span className="text-xs font-medium text-foreground/80 block capitalize">
                        {trigger.trigger_type}
                      </span>
                      {trigger.description && trigger.description !== trigger.trigger_type && (
                        <span className="text-[10px] text-muted-foreground/50 block truncate">
                          {trigger.description}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground/40 italic">No triggers defined</p>
          )}
        </div>
      </div>

      {/* Adopt button row */}
      <div className="flex items-center justify-between pt-1">
        <button
          onClick={onAdopt}
          className="px-4 py-2 text-xs rounded-xl bg-violet-500/15 text-violet-300 border border-violet-500/25 hover:bg-violet-500/25 transition-colors flex items-center gap-2"
        >
          <Download className="w-3.5 h-3.5" />
          Adopt as Persona
        </button>
        {displayFlows.length > 0 && (
          <button
            onClick={onViewFlows}
            className="px-3 py-1.5 text-xs rounded-lg bg-violet-500/8 text-violet-400/70 hover:bg-violet-500/15 transition-colors inline-flex items-center gap-1.5"
          >
            <Workflow className="w-3 h-3" />
            View {displayFlows.length} flow{displayFlows.length !== 1 ? 's' : ''}
          </button>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

interface Props {
  isRunning: boolean;
  handleStartReview: () => void;
  credentials?: CredentialMetadata[];
  connectorDefinitions?: ConnectorDefinition[];
  onPersonaCreated?: () => void;
  onViewFlows: (review: PersonaDesignReview) => void;
}

export default function GeneratedReviewsTab({
  isRunning,
  handleStartReview,
  credentials = [],
  connectorDefinitions = [],
  onPersonaCreated,
  onViewFlows,
}: Props) {
  const templateAdoptActive = usePersonaStore((s) => s.templateAdoptActive);
  const gallery = useTemplateGallery();

  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [adoptReview, setAdoptReview] = useState<PersonaDesignReview | null>(null);
  const [adoptMode, setAdoptMode] = useState<'simple' | 'ai-wizard' | null>(null);
  const [showCreateTemplate, setShowCreateTemplate] = useState(false);
  const [detailReview, setDetailReview] = useState<PersonaDesignReview | null>(null);
  const [rebuildReview, setRebuildReview] = useState<PersonaDesignReview | null>(null);

  const installedConnectorNames = useMemo(
    () => new Set(connectorDefinitions.map((c) => c.name)),
    [connectorDefinitions],
  );
  const credentialServiceTypes = useMemo(
    () => new Set(credentials.map((c) => c.service_type)),
    [credentials],
  );

  const handleAdoptClick = (review: PersonaDesignReview) => {
    setAdoptReview(review);
    setAdoptMode('simple');
  };

  const handleSwitchToAIWizard = () => {
    setAdoptMode('ai-wizard');
  };

  const handleCloseAdopt = () => {
    setAdoptReview(null);
    setAdoptMode(null);
  };

  const handleDeleteReview = async (id: string) => {
    try {
      await deleteDesignReview(id);
      gallery.refresh();
    } catch (err) {
      console.error('Failed to delete template:', err);
    }
  };

  const handlePersonaCreated = () => {
    handleCloseAdopt();
    gallery.refresh();
    onPersonaCreated?.();
  };

  // Re-open the AI wizard to show background progress
  const handleResumeAdoption = () => {
    try {
      const raw = window.localStorage.getItem(ADOPT_CONTEXT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { templateName?: string };
        const match = gallery.items.find((r) => r.test_case_name === parsed.templateName);
        if (match) {
          setAdoptReview(match);
          setAdoptMode('ai-wizard');
          return;
        }
      }
    } catch { /* ignore */ }
    if (gallery.items[0]) {
      setAdoptReview(gallery.items[0]);
      setAdoptMode('ai-wizard');
    }
  };

  // Loading state
  if (gallery.isLoading && gallery.items.length === 0 && gallery.total === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground/80 text-sm">
        Loading templates...
      </div>
    );
  }

  // Empty state
  if (gallery.total === 0 && !gallery.search && gallery.connectorFilter.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground/80">
        <FlaskConical className="w-12 h-12 opacity-30" />
        <p className="text-sm font-medium">No generated templates yet</p>
        <p className="text-sm text-muted-foreground/80 text-center max-w-xs">
          Generate templates to build a library of reusable persona configurations
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => setShowCreateTemplate(true)}
            className="px-4 py-2 text-sm rounded-xl bg-emerald-500/15 text-emerald-300 border border-emerald-500/25 hover:bg-emerald-500/25 transition-colors flex items-center gap-2"
          >
            <Plus className="w-3.5 h-3.5" />
            New Template
          </button>
          <button
            onClick={handleStartReview}
            disabled={isRunning}
            className="px-4 py-2 text-sm rounded-xl bg-violet-500/15 text-violet-300 border border-violet-500/25 hover:bg-violet-500/25 transition-colors flex items-center gap-2"
          >
            <Play className="w-3.5 h-3.5" />
            Generate Templates
          </button>
        </div>
        <CreateTemplateModal
          isOpen={showCreateTemplate}
          onClose={() => setShowCreateTemplate(false)}
          onTemplateCreated={() => {
            setShowCreateTemplate(false);
            gallery.refresh();
            onPersonaCreated?.();
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Background adoption banner */}
      {templateAdoptActive && !adoptReview && (
        <div className="mx-4 mt-3 mb-0">
          <button
            onClick={handleResumeAdoption}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-violet-500/8 border border-violet-500/15 hover:bg-violet-500/12 transition-colors text-left"
          >
            <div className="w-7 h-7 rounded-lg bg-violet-500/15 flex items-center justify-center flex-shrink-0">
              <Sparkles className="w-4 h-4 text-violet-400 animate-pulse" />
            </div>
            <div className="flex-1 min-w-0">
              <span className="text-sm font-medium text-violet-300 block">Template adoption in progress</span>
              <span className="text-xs text-muted-foreground/80">Click to view progress</span>
            </div>
            <div className="w-2 h-2 rounded-full bg-violet-400 animate-pulse flex-shrink-0" />
          </button>
        </div>
      )}

      {/* Search/Filter/Sort Bar */}
      <TemplateSearchBar
        search={gallery.search}
        onSearchChange={gallery.setSearch}
        sortBy={gallery.sortBy}
        onSortByChange={gallery.setSortBy}
        sortDir={gallery.sortDir}
        onSortDirChange={gallery.setSortDir}
        connectorFilter={gallery.connectorFilter}
        onConnectorFilterChange={gallery.setConnectorFilter}
        availableConnectors={gallery.availableConnectors}
        total={gallery.total}
        page={gallery.page}
        perPage={gallery.perPage}
        onNewTemplate={() => setShowCreateTemplate(true)}
      />

      {/* Table */}
      <div className="flex-1 overflow-y-auto">
        {gallery.items.length > 0 ? (
          <table className="w-full">
            <thead className="sticky top-0 z-10">
              <tr className="bg-background border-b border-primary/10" style={{ backgroundColor: 'hsl(var(--background))' }}>
                <th className="text-left text-xs font-medium text-muted-foreground/70 px-6 py-2.5 w-8 bg-secondary/80" />
                <th className="text-left text-xs font-medium text-muted-foreground/70 px-4 py-2.5 bg-secondary/80">Template Name</th>
                <th className="text-left text-xs font-medium text-muted-foreground/70 px-4 py-2.5 bg-secondary/80">Connectors</th>
                <th className="text-center text-xs font-medium text-muted-foreground/70 px-4 py-2.5 bg-secondary/80">Flows</th>
                <th className="text-center text-xs font-medium text-muted-foreground/70 px-4 py-2.5 bg-secondary/80">Quality</th>
                <th className="text-center text-xs font-medium text-muted-foreground/70 px-4 py-2.5 bg-secondary/80">Status</th>
                <th className="text-right text-xs font-medium text-muted-foreground/70 px-6 py-2.5 w-24 bg-secondary/80" />
              </tr>
            </thead>
            <tbody>
              {gallery.items.map((review) => {
                const isExpanded = expandedRow === review.id;
                const connectors: string[] = parseJsonSafe(review.connectors_used, []);
                const qualityScore = getQualityScore(review);
                const designResult = parseJsonSafe<DesignAnalysisResult | null>(review.design_result, null);
                const flowCount = parseJsonSafe<unknown[]>(review.use_case_flows, []).length;

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
                      className="group border-b border-primary/5 hover:bg-secondary/30 cursor-pointer transition-colors"
                    >
                      <td className="px-6 py-3">
                        {isExpanded ? (
                          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/80" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/80" />
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div>
                          <span className="text-sm font-medium text-foreground/80 block">
                            {review.test_case_name}
                          </span>
                          <span className="text-xs text-muted-foreground/60 block truncate max-w-[400px]">
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
                        {flowCount > 0 ? (
                          <span className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-300">
                            <Workflow className="w-3 h-3" />
                            {flowCount}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground/40">--</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {qualityScore !== null ? (
                          <span
                            className={`inline-flex items-center px-2.5 py-1 text-xs font-mono font-semibold rounded-full border ${getQualityColor(qualityScore)}`}
                          >
                            {qualityScore}%
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground/60">--</span>
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
                          <RowActionMenu
                            reviewId={review.id}
                            onDelete={handleDeleteReview}
                            onViewDetails={() => setDetailReview(review)}
                            onRebuild={() => setRebuildReview(review)}
                          />
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={7} className="px-6 py-4 bg-secondary/20 border-b border-primary/10">
                          <ExpandedRowContent
                            review={review}
                            designResult={designResult}
                            installedConnectorNames={installedConnectorNames}
                            credentialServiceTypes={credentialServiceTypes}
                            onViewFlows={() => onViewFlows(review)}
                            onAdopt={() => handleAdoptClick(review)}
                          />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div className="flex items-center justify-center h-40 text-sm text-muted-foreground/60">
            No templates match your search
          </div>
        )}
      </div>

      {/* Pagination */}
      <TemplatePagination
        page={gallery.page}
        totalPages={gallery.totalPages}
        onPageChange={gallery.setPage}
      />

      {/* Detail Modal */}
      <TemplateDetailModal
        isOpen={!!detailReview}
        onClose={() => setDetailReview(null)}
        review={detailReview}
        onAdopt={handleAdoptClick}
        onDelete={handleDeleteReview}
        onViewFlows={(review) => {
          setDetailReview(null);
          onViewFlows(review);
        }}
      />

      {/* Simple Adoption Dialog */}
      <TemplateAdoptDialog
        isOpen={adoptMode === 'simple' && !!adoptReview}
        onClose={handleCloseAdopt}
        review={adoptReview}
        credentials={credentials}
        connectorDefinitions={connectorDefinitions}
        onPersonaCreated={handlePersonaCreated}
        onCustomizeWithAI={handleSwitchToAIWizard}
      />

      {/* AI Wizard Modal */}
      <AdoptionWizardModal
        isOpen={adoptMode === 'ai-wizard' && !!adoptReview}
        onClose={handleCloseAdopt}
        review={adoptReview}
        credentials={credentials}
        connectorDefinitions={connectorDefinitions}
        onPersonaCreated={handlePersonaCreated}
      />

      {/* Create Template Modal */}
      <CreateTemplateModal
        isOpen={showCreateTemplate}
        onClose={() => setShowCreateTemplate(false)}
        onTemplateCreated={() => {
          setShowCreateTemplate(false);
          gallery.refresh();
          onPersonaCreated?.();
        }}
      />

      {/* Rebuild Modal */}
      {rebuildReview && (
        <RebuildModal
          isOpen={!!rebuildReview}
          onClose={() => setRebuildReview(null)}
          review={rebuildReview}
          onCompleted={() => {
            setRebuildReview(null);
            gallery.refresh();
          }}
        />
      )}
    </div>
  );
}
