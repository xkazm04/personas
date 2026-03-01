import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
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
  Workflow,
  TrendingUp,
} from 'lucide-react';
import { getConnectorMeta, ConnectorIcon } from '@/features/shared/components/ConnectorMeta';
import { usePersonaStore } from '@/stores/personaStore';
import { useTemplateGallery } from '@/hooks/design/useTemplateGallery';
import { deleteDesignReview, cleanupDuplicateReviews, backfillServiceFlow } from '@/api/reviews';
import { deriveConnectorReadiness } from './ConnectorReadiness';
import { TemplateSearchBar } from './TemplateSearchBar';
import { TemplatePagination } from './TemplatePagination';
import { TemplateDetailModal } from './TemplateDetailModal';
import { CreateTemplateModal } from './CreateTemplateModal';
import { ADOPT_CONTEXT_KEY } from './useAdoptReducer';
import AdoptionWizardModal from './AdoptionWizardModal';
import { RebuildModal } from './RebuildModal';
import { ConnectorPipeline } from './ConnectorPipeline';
import { useBackgroundRebuild } from '@/hooks/design/useBackgroundRebuild';
import { useBackgroundPreview } from '@/hooks/design/useBackgroundPreview';
import { TemplatePreviewModal } from './TemplatePreviewModal';
import { DimensionRadial } from './DimensionRadial';
import { useModalStack } from './useModalStack';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import type { ConnectorPipelineStep, DesignAnalysisResult, SuggestedConnector } from '@/lib/types/designTypes';
import type { UseCaseFlow } from '@/lib/types/frontendTypes';
import type { CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';
import { parseJsonOrDefault as parseJsonSafe } from '@/lib/utils/parseJson';
import { ConnectorCredentialModal } from '@/features/vault/components/ConnectorCredentialModal';
import { CredentialTemplateForm } from '@/features/vault/components/CredentialTemplateForm';
import { isGoogleOAuthConnector } from '@/lib/utils/connectors';
import { testCredentialDesignHealthcheck } from '@/api/credentialDesign';
import type { ConnectorMeta } from '@/features/shared/components/ConnectorMeta';

// ============================================================================
// Helpers
// ============================================================================



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
    <div ref={menuRef} className={`relative ${open ? 'z-20' : ''}`}>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen((prev) => !prev);
        }}
        className="p-1 rounded-md opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-secondary/60 transition-all"
        aria-label="Row actions"
      >
        <MoreVertical className="w-4.5 h-4.5 text-muted-foreground/90" />
      </button>
      {open && (
        <div className="absolute right-0 bottom-full mb-1 z-50 min-w-[180px] py-1.5 bg-background border border-primary/20 rounded-lg shadow-2xl backdrop-blur-sm">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              onViewDetails();
            }}
            className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-foreground/80 hover:bg-primary/5 transition-colors text-left"
          >
            <Eye className="w-4 h-4" />
            View Details
          </button>
          {import.meta.env.VITE_DEVELOPMENT === 'true' && (
            <>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                  onRebuild();
                }}
                className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-blue-400 hover:bg-blue-500/10 transition-colors text-left"
              >
                <RefreshCw className="w-4 h-4" />
                Rebuild
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                  onDelete(reviewId);
                }}
                className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-red-400 hover:bg-red-500/10 transition-colors text-left"
              >
                <Trash2 className="w-4 h-4" />
                Delete template
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Connector Icon Button — clickable icon for adding credentials
// ============================================================================

function ConnectorIconButton({
  connectorName,
  meta,
  isReady,
  onAddCredential,
}: {
  connectorName: string;
  meta: ConnectorMeta;
  isReady: boolean;
  onAddCredential: (connectorName: string) => void;
}) {
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isReady) return;
    onAddCredential(connectorName);
  };

  return (
    <div
      className="relative flex-shrink-0"
      title={`${meta.label}${isReady ? '' : ' — click to add credential'}`}
      data-testid={`connector-readiness-dot-${connectorName}`}
    >
      <div
        onClick={handleClick}
        className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all ${
          isReady
            ? ''
            : 'grayscale hover:grayscale-0 cursor-pointer hover:ring-2 hover:ring-amber-500/30'
        }`}
        style={{ backgroundColor: `${meta.color}18` }}
      >
        <ConnectorIcon meta={meta} size="w-4 h-4" />
      </div>
      <span
        className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full ${
          isReady
            ? 'bg-emerald-500'
            : 'bg-amber-500/60 border border-dashed border-amber-500/30'
        }`}
      />
    </div>
  );
}

// ============================================================================
// Catalog Credential Modal — wraps CredentialTemplateForm in a modal overlay
// ============================================================================

function CatalogCredentialModal({
  connectorDefinition,
  onSave,
  onClose,
}: {
  connectorDefinition: ConnectorDefinition;
  onSave: (values: Record<string, string>) => void;
  onClose: () => void;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const isGoogleTemplate = isGoogleOAuthConnector(connectorDefinition);

  const effectiveTemplateFields = useMemo(() => {
    const fields = connectorDefinition.fields ?? [];
    if (isGoogleTemplate) {
      return fields.filter(
        (f) => !['client_id', 'client_secret', 'refresh_token', 'scopes'].includes(f.key),
      );
    }
    return fields;
  }, [connectorDefinition.fields, isGoogleTemplate]);

  const [credentialName, setCredentialName] = useState(
    `${connectorDefinition.label} Credential`,
  );
  const [isHealthchecking, setIsHealthchecking] = useState(false);
  const [healthcheckResult, setHealthcheckResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [isAuthorizingOAuth, setIsAuthorizingOAuth] = useState(false);
  const [oauthCompletedAt] = useState<string | null>(null);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onClose();
  };

  const handleHealthcheck = useCallback(
    async (values: Record<string, string>) => {
      setIsHealthchecking(true);
      setHealthcheckResult(null);
      try {
        const result = await usePersonaStore
          .getState()
          .healthcheckCredentialPreview(connectorDefinition.name, values);
        setHealthcheckResult(result);
      } catch {
        setHealthcheckResult({ success: false, message: 'Healthcheck failed' });
      } finally {
        setIsHealthchecking(false);
      }
    },
    [connectorDefinition.name],
  );

  const handleDynamicHealthcheck = useCallback(
    async (values: Record<string, string>) => {
      setIsHealthchecking(true);
      setHealthcheckResult(null);
      try {
        const result = await testCredentialDesignHealthcheck(
          `Test connection for ${connectorDefinition.label} connector`,
          {
            name: connectorDefinition.name,
            label: connectorDefinition.label,
            fields: connectorDefinition.fields,
          },
          values,
        );
        setHealthcheckResult({ success: result.success, message: result.message });
      } catch {
        setHealthcheckResult({ success: false, message: 'Connection test failed' });
      } finally {
        setIsHealthchecking(false);
      }
    },
    [connectorDefinition],
  );

  const handleOAuthConsent = useCallback((_values: Record<string, string>) => {
    setIsAuthorizingOAuth(true);
    // OAuth flow would be handled here for Google connectors
  }, []);

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        className="max-w-2xl w-full mx-4 max-h-[85vh] overflow-y-auto"
      >
        <CredentialTemplateForm
          selectedConnector={connectorDefinition}
          credentialName={credentialName}
          onCredentialNameChange={setCredentialName}
          effectiveTemplateFields={effectiveTemplateFields}
          isGoogleTemplate={isGoogleTemplate}
          isAuthorizingOAuth={isAuthorizingOAuth}
          oauthCompletedAt={oauthCompletedAt}
          onCreateCredential={onSave}
          onOAuthConsent={handleOAuthConsent}
          onCancel={onClose}
          onValuesChanged={() => {
            setHealthcheckResult(null);
          }}
          onHealthcheck={
            connectorDefinition.healthcheck_config ? handleHealthcheck : handleDynamicHealthcheck
          }
          isHealthchecking={isHealthchecking}
          healthcheckResult={healthcheckResult}
        />
      </div>
    </div>
  );
}

// ============================================================================
// Expanded Row — Consolidated Layout (Summary + Rail → Hero Cards → Actions)
// ============================================================================

function ExpandedRowContent({
  review,
  designResult,
  allConnectorsReady,
  onAdopt,
  onTryIt,
}: {
  review: PersonaDesignReview;
  designResult: DesignAnalysisResult | null;
  allConnectorsReady: boolean;
  onAdopt: () => void;
  onTryIt: () => void;
}) {
  const flows = parseJsonSafe<UseCaseFlow[]>(review.use_case_flows, []);
  const displayFlows = flows.length > 0
    ? flows
    : (() => {
        const raw = designResult as unknown as Record<string, unknown> | null;
        return raw?.use_case_flows
          ? parseJsonSafe<UseCaseFlow[]>(JSON.stringify(raw.use_case_flows), [])
          : [];
      })();

  // Parse service_flow pipeline from designResult
  const pipelineSteps: ConnectorPipelineStep[] = (() => {
    const raw = designResult as unknown as Record<string, unknown> | null;
    const sf = raw?.service_flow;
    if (!Array.isArray(sf) || sf.length === 0) return [];
    // Support new object format
    if (typeof sf[0] === 'object' && sf[0] !== null && 'connector_name' in sf[0]) {
      return sf as ConnectorPipelineStep[];
    }
    return [];
  })();

  return (
    <div className="flex items-center justify-center gap-4 py-3 px-4">
      {/* Connector pipeline diagram */}
      {pipelineSteps.length > 0 && (
        <ConnectorPipeline steps={pipelineSteps} />
      )}

      {/* Use case bullet list */}
      {displayFlows.length > 0 ? (
        <ul className="list-disc list-inside space-y-0.5">
          {displayFlows.map((flow) => (
            <li key={flow.id} className="text-sm text-foreground/80">
              {flow.name}
            </li>
          ))}
        </ul>
      ) : (
        <div className="text-sm text-muted-foreground/40 italic">
          No use case flows defined
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {allConnectorsReady && (
          <button
            onClick={onTryIt}
            className="px-3 py-2 text-sm rounded-lg bg-cyan-500/10 text-cyan-300 border border-cyan-500/20 hover:bg-cyan-500/20 transition-colors inline-flex items-center gap-1.5"
          >
            <Play className="w-3.5 h-3.5" />
            Try It
          </button>
        )}
        <button
          onClick={onAdopt}
          className="px-3.5 py-2 text-sm rounded-lg bg-violet-500/15 text-violet-300 border border-violet-500/25 hover:bg-violet-500/25 transition-colors inline-flex items-center gap-1.5"
        >
          <Download className="w-3.5 h-3.5" />
          Adopt
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

type TemplateModal =
  | { type: 'adopt'; review: PersonaDesignReview }
  | { type: 'detail'; review: PersonaDesignReview }
  | { type: 'rebuild'; review: PersonaDesignReview }
  | { type: 'preview'; review: PersonaDesignReview }
  | { type: 'create' };

interface Props {
  isRunning: boolean;
  handleStartReview: () => void;
  credentials?: CredentialMetadata[];
  connectorDefinitions?: ConnectorDefinition[];
  onPersonaCreated?: () => void;
  onViewFlows: (review: PersonaDesignReview) => void;
  onTotalChange?: (total: number) => void;
}

export default function GeneratedReviewsTab({
  isRunning,
  handleStartReview,
  credentials = [],
  connectorDefinitions = [],
  onPersonaCreated,
  onViewFlows,
  onTotalChange,
}: Props) {
  const templateAdoptActive = usePersonaStore((s) => s.templateAdoptActive);
  const credentialServiceTypesArray = useMemo(
    () => credentials.map((c) => c.service_type),
    [credentials],
  );
  const gallery = useTemplateGallery(credentialServiceTypesArray);

  // Report total count to parent
  useEffect(() => {
    onTotalChange?.(gallery.total);
  }, [gallery.total, onTotalChange]);

  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const modals = useModalStack<TemplateModal>();
  const [isCleaningUp, setIsCleaningUp] = useState(false);
  const [isBackfillingPipeline, setIsBackfillingPipeline] = useState(false);

  // Background rebuild state — persists across modal open/close
  const rebuild = useBackgroundRebuild(() => gallery.refresh());

  // Background preview state — persists across modal open/close
  const preview = useBackgroundPreview();

  const installedConnectorNames = useMemo(
    () => new Set(connectorDefinitions.map((c) => c.name)),
    [connectorDefinitions],
  );
  const credentialServiceTypes = useMemo(
    () => new Set(credentials.map((c) => c.service_type)),
    [credentials],
  );

  // ── Connector credential modal state ──
  const [credentialModalTarget, setCredentialModalTarget] = useState<{
    connectorName: string;
    suggestedConnector: SuggestedConnector | null;
    connectorDefinition: ConnectorDefinition | null;
  } | null>(null);

  const handleConnectorCredentialClick = useCallback(
    (connectorName: string, suggestedConnector: SuggestedConnector | null, connDef: ConnectorDefinition | null) => {
      setCredentialModalTarget({ connectorName, suggestedConnector, connectorDefinition: connDef });
    },
    [],
  );

  const handleCredentialSave = useCallback(
    async (values: Record<string, string>) => {
      if (!credentialModalTarget) return;
      const meta = getConnectorMeta(credentialModalTarget.connectorName);
      await usePersonaStore.getState().createCredential({
        name: `${meta.label} credential`,
        service_type: credentialModalTarget.connectorName,
        data: values,
      });
      setCredentialModalTarget(null);
    },
    [credentialModalTarget],
  );

  const handleDeleteReview = async (id: string) => {
    try {
      await deleteDesignReview(id);
      gallery.refresh();
    } catch (err) {
      console.error('Failed to delete template:', err);
    }
  };

  const handleCleanupDuplicates = async () => {
    setIsCleaningUp(true);
    try {
      await cleanupDuplicateReviews();
      gallery.refresh();
    } catch (err) {
      console.error('Failed to cleanup duplicates:', err);
    } finally {
      setIsCleaningUp(false);
    }
  };

  const handleBackfillPipeline = async () => {
    setIsBackfillingPipeline(true);
    try {
      await backfillServiceFlow();
      gallery.refresh();
    } catch (err) {
      console.error('Failed to backfill service flow:', err);
    } finally {
      setIsBackfillingPipeline(false);
    }
  };

  const handlePersonaCreated = () => {
    modals.close('adopt');
    gallery.refresh();
    onPersonaCreated?.();
  };

  // Re-open the wizard to show background progress
  const handleResumeAdoption = () => {
    try {
      const raw = window.localStorage.getItem(ADOPT_CONTEXT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { templateName?: string };
        const match = gallery.items.find((r) => r.test_case_name === parsed.templateName);
        if (match) {
          modals.open({ type: 'adopt', review: match });
          return;
        }
        // Template not found on current page — may have been deleted or is on another page.
        // Do NOT fall through to gallery.items[0] which would open the wrong template.
        console.warn(
          `[ResumeAdoption] Template "${parsed.templateName}" not found in current gallery page. ` +
          'The adoption may still be running in the background.',
        );
      }
    } catch { /* ignore parse errors */ }
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
  if (gallery.total === 0 && !gallery.search && gallery.connectorFilter.length === 0 && gallery.categoryFilter.length === 0 && gallery.coverageFilter === 'all' && !gallery.aiSearchActive) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground/80">
        <FlaskConical className="w-12 h-12 opacity-30" />
        <p className="text-sm font-medium">No generated templates yet</p>
        <p className="text-sm text-muted-foreground/80 text-center max-w-xs">
          Generate templates to build a library of reusable persona configurations
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => modals.open({ type: 'create' })}
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
          isOpen={modals.isOpen('create')}
          onClose={() => modals.close('create')}
          onTemplateCreated={() => {
            modals.close('create');
            gallery.refresh();
            onPersonaCreated?.();
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full" style={{ minWidth: 960 }}>
      {/* Background adoption banner */}
      {templateAdoptActive && !modals.isOpen('adopt') && (
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

      {/* Background rebuild banner */}
      {rebuild.isActive && !modals.isOpen('rebuild') && (
        <div className="mx-4 mt-3 mb-0">
          <button
            onClick={() => {
              const review = gallery.items.find((r) => r.id === rebuild.reviewId);
              if (review) modals.open({ type: 'rebuild', review });
            }}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-blue-500/8 border border-blue-500/15 hover:bg-blue-500/12 transition-colors text-left"
          >
            <div className="w-7 h-7 rounded-lg bg-blue-500/15 flex items-center justify-center flex-shrink-0">
              <RefreshCw className="w-4 h-4 text-blue-400 animate-spin" />
            </div>
            <div className="flex-1 min-w-0">
              <span className="text-sm font-medium text-blue-300 block">
                Rebuilding: {rebuild.reviewName ?? 'template'}
              </span>
              <span className="text-xs text-muted-foreground/80">Click to view progress</span>
            </div>
            <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse flex-shrink-0" />
          </button>
        </div>
      )}

      {/* Background preview banner */}
      {preview.isActive && !modals.isOpen('preview') && (
        <div className="mx-4 mt-3 mb-0">
          <button
            onClick={() => {
              const review = gallery.items.find((r) => r.id === preview.reviewId);
              if (review) modals.open({ type: 'preview', review });
            }}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-cyan-500/8 border border-cyan-500/15 hover:bg-cyan-500/12 transition-colors text-left"
          >
            <div className="w-7 h-7 rounded-lg bg-cyan-500/15 flex items-center justify-center flex-shrink-0">
              <Play className="w-4 h-4 text-cyan-400 animate-pulse" />
            </div>
            <div className="flex-1 min-w-0">
              <span className="text-sm font-medium text-cyan-300 block">
                Testing: {preview.reviewName ?? 'template'}
              </span>
              <span className="text-xs text-muted-foreground/80">Click to view output</span>
            </div>
            <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse flex-shrink-0" />
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
        categoryFilter={gallery.categoryFilter}
        onCategoryFilterChange={gallery.setCategoryFilter}
        availableConnectors={gallery.availableConnectors}
        availableCategories={gallery.availableCategories}
        total={gallery.total}
        page={gallery.page}
        perPage={gallery.perPage}
        onNewTemplate={() => modals.open({ type: 'create' })}
        onCleanupDuplicates={handleCleanupDuplicates}
        isCleaningUp={isCleaningUp}
        onBackfillPipeline={handleBackfillPipeline}
        isBackfillingPipeline={isBackfillingPipeline}
        coverageFilter={gallery.coverageFilter}
        onCoverageFilterChange={gallery.setCoverageFilter}
        aiSearchMode={gallery.aiSearchMode}
        onAiSearchToggle={() => {
          gallery.setAiSearchMode(!gallery.aiSearchMode);
          if (gallery.aiSearchMode) gallery.clearAiSearch();
        }}
        aiSearchLoading={gallery.aiSearchLoading}
        aiSearchRationale={gallery.aiSearchRationale}
        aiSearchActive={gallery.aiSearchActive}
        onAiSearchSubmit={(q) => gallery.triggerAiSearch(q)}
        aiCliLog={gallery.aiCliLog}
      />

      {/* Trending Carousel */}
      {gallery.trendingTemplates.length > 0 && !gallery.search && gallery.connectorFilter.length === 0 && gallery.categoryFilter.length === 0 && (
        <div className="px-4 py-3 border-b border-primary/10 flex-shrink-0">
          <div className="flex items-center gap-2 mb-2.5">
            <TrendingUp className="w-4 h-4 text-emerald-400/70" />
            <span className="text-xs font-medium text-muted-foreground/70 uppercase tracking-wide">
              Most Adopted This Week
            </span>
          </div>
          <div className="flex gap-2.5 overflow-x-auto pb-1">
            {gallery.trendingTemplates.map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  setExpandedRow(t.id);
                  modals.open({ type: 'detail', review: t });
                }}
                className="flex-shrink-0 w-[200px] p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/12 hover:border-emerald-500/25 hover:bg-emerald-500/10 transition-all text-left group/trend"
              >
                <div className="text-sm font-medium text-foreground/80 group-hover/trend:text-emerald-300 truncate">
                  {t.test_case_name}
                </div>
                <div className="flex items-center gap-2 mt-1.5">
                  <span className="inline-flex items-center gap-1 text-[10px] font-mono text-emerald-400/70">
                    <Download className="w-2.5 h-2.5" />
                    {t.adoption_count}
                  </span>
                  <DimensionRadial designResult={parseJsonSafe<DesignAnalysisResult | null>(t.design_result, null)} size={20} />
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Table */}
      <div className="flex-1 flex flex-col overflow-x-auto">
        {gallery.items.length > 0 ? (
          <div className="flex-1 overflow-y-auto">
          <table className="w-full" style={{ minWidth: 960 }}>
            <thead className="sticky top-0 z-10">
              <tr className="bg-background border-b border-primary/10" style={{ backgroundColor: 'hsl(var(--background))' }}>
                <th className="text-left text-sm font-medium text-muted-foreground/70 px-6 py-3 w-10 bg-secondary/80" />
                <th className="text-left text-sm font-medium text-muted-foreground/70 px-4 py-3 bg-secondary/80">Template Name</th>
                <th className="text-center text-sm font-medium text-muted-foreground/70 px-4 py-3 bg-secondary/80">Adoptions</th>
                <th className="text-right text-sm font-medium text-muted-foreground/70 px-6 py-3 w-10 bg-secondary/80" />
              </tr>
            </thead>
            <tbody>
              {gallery.items.map((review) => {
                const isExpanded = expandedRow === review.id;
                const connectors: string[] = parseJsonSafe(review.connectors_used, []);
                const designResult = parseJsonSafe<DesignAnalysisResult | null>(review.design_result, null);
                const flowCount = parseJsonSafe<unknown[]>(review.use_case_flows, []).length;

                const readinessStatuses = designResult?.suggested_connectors
                  ? deriveConnectorReadiness(designResult.suggested_connectors, installedConnectorNames, credentialServiceTypes)
                  : [];

                const allConnectorsReady = connectors.length > 0 && connectors.every((c) => {
                  const status = readinessStatuses.find((s) => s.connector_name === c);
                  return status?.health === 'ready';
                });

                return (
                  <React.Fragment key={review.id}>
                    <tr
                      onClick={() => setExpandedRow(isExpanded ? null : review.id)}
                      className="group border-b border-primary/5 hover:bg-secondary/30 cursor-pointer transition-colors"
                      data-testid={`template-row-${review.id}`}
                    >
                      <td className="px-6 py-4">
                        {isExpanded ? (
                          <ChevronDown className="w-4.5 h-4.5 text-muted-foreground/80" />
                        ) : (
                          <ChevronRight className="w-4.5 h-4.5 text-muted-foreground/80" />
                        )}
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex items-center justify-between gap-4">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-base font-semibold text-foreground/80">
                                {review.test_case_name}
                              </span>
                              {review.adoption_count > 0 && (
                                <span
                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-mono rounded bg-emerald-500/10 text-emerald-400/70 border border-emerald-500/15"
                                  title={`Adopted ${review.adoption_count} time${review.adoption_count !== 1 ? 's' : ''}`}
                                >
                                  <Download className="w-2.5 h-2.5" />
                                  {review.adoption_count}
                                </span>
                              )}
                            </div>
                            {/* Second line: instruction + clickable flow count */}
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-sm text-muted-foreground/60 truncate max-w-[400px]">
                                {review.instruction.length > 80
                                  ? review.instruction.slice(0, 80) + '...'
                                  : review.instruction}
                              </span>
                              {flowCount > 0 && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onViewFlows(review);
                                  }}
                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded bg-violet-500/10 text-violet-400/70 border border-violet-500/15 hover:bg-violet-500/20 transition-colors flex-shrink-0"
                                  title="View flows"
                                >
                                  <Workflow className="w-2.5 h-2.5" />
                                  {flowCount} flow{flowCount !== 1 ? 's' : ''}
                                </button>
                              )}
                            </div>
                          </div>
                          {/* Connector icons — right side */}
                          {connectors.length > 0 && (
                            <div className="flex items-center gap-1.5 flex-shrink-0">
                              {connectors.map((c) => {
                                const meta = getConnectorMeta(c);
                                const status = readinessStatuses.find((s) => s.connector_name === c);
                                const isReady = status?.health === 'ready';
                                return (
                                  <ConnectorIconButton
                                    key={c}
                                    connectorName={c}
                                    meta={meta}
                                    isReady={isReady}
                                    onAddCredential={(name) => {
                                      const sugConn = designResult?.suggested_connectors?.find((sc) => sc.name === name) ?? null;
                                      const connDef = connectorDefinitions.find((d) => d.name === name) ?? null;
                                      handleConnectorCredentialClick(name, sugConn, connDef);
                                    }}
                                  />
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-4 text-center">
                        <div className="flex justify-center">
                          {review.adoption_count > 0 ? (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-300">
                              <Download className="w-3.5 h-3.5" />
                              {review.adoption_count}
                            </span>
                          ) : (
                            <span className="text-sm text-muted-foreground/40">--</span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <RowActionMenu
                          reviewId={review.id}
                          onDelete={handleDeleteReview}
                          onViewDetails={() => modals.open({ type: 'detail', review })}
                          onRebuild={() => {
                            // Reset rebuild state if starting a new rebuild (different review)
                            if (rebuild.reviewId !== review.id || rebuild.phase === 'completed' || rebuild.phase === 'failed') {
                              rebuild.resetRebuild();
                            }
                            modals.open({ type: 'rebuild', review });
                          }}
                        />
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={4} className="border-b border-primary/10 bg-secondary/20">
                          <ExpandedRowContent
                            review={review}
                            designResult={designResult}
                            allConnectorsReady={allConnectorsReady}
                            onAdopt={() => modals.open({ type: 'adopt', review })}
                            onTryIt={() => {
                              // Reset preview state if switching to a different template
                              if (preview.reviewId !== review.id || preview.phase === 'completed' || preview.phase === 'failed') {
                                preview.resetPreview();
                              }
                              modals.open({ type: 'preview', review });
                            }}
                          />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
          </div>
        ) : (
          <div className="flex items-center justify-center flex-1 min-h-[200px] text-sm text-muted-foreground/60" style={{ minWidth: 960 }}>
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
        isOpen={modals.isOpen('detail')}
        onClose={() => modals.close('detail')}
        review={modals.find('detail')?.review ?? null}
        onAdopt={(review) => modals.open({ type: 'adopt', review })}
        onDelete={handleDeleteReview}
        onViewFlows={(review) => {
          modals.close('detail');
          onViewFlows(review);
        }}
        onTryIt={(review) => {
          if (preview.reviewId !== review.id || preview.phase === 'completed' || preview.phase === 'failed') {
            preview.resetPreview();
          }
          modals.close('detail');
          modals.open({ type: 'preview', review });
        }}
      />

      {/* Adoption Wizard Modal */}
      <AdoptionWizardModal
        isOpen={modals.isOpen('adopt')}
        onClose={() => modals.close('adopt')}
        review={modals.find('adopt')?.review ?? null}
        credentials={credentials}
        connectorDefinitions={connectorDefinitions}
        onPersonaCreated={handlePersonaCreated}
      />

      {/* Create Template Modal */}
      <CreateTemplateModal
        isOpen={modals.isOpen('create')}
        onClose={() => modals.close('create')}
        onTemplateCreated={() => {
          modals.close('create');
          gallery.refresh();
          onPersonaCreated?.();
        }}
      />

      {/* Rebuild Modal */}
      {modals.isOpen('rebuild') && (
        <RebuildModal
          isOpen
          onClose={() => modals.close('rebuild')}
          review={modals.find('rebuild')!.review}
          phase={rebuild.phase}
          lines={rebuild.lines}
          error={rebuild.error}
          onStartRebuild={(dir) => {
            const r = modals.find('rebuild')!.review;
            rebuild.startRebuild(r.id, r.test_case_name, dir);
          }}
          onCancel={() => rebuild.cancelCurrentRebuild()}
        />
      )}

      {/* Template Preview Modal */}
      <TemplatePreviewModal
        isOpen={modals.isOpen('preview')}
        onClose={() => modals.close('preview')}
        review={modals.find('preview')?.review ?? null}
        phase={preview.phase}
        lines={preview.lines}
        error={preview.error}
        hasStarted={preview.hasStarted}
        onStartPreview={(rId, rName, draftJson) => preview.startPreview(rId, rName, draftJson)}
        onRetryPreview={(draftJson) => preview.retryPreview(draftJson)}
      />

      {/* Connector Credential Modal — triggered from table connector icons */}
      {credentialModalTarget && credentialModalTarget.connectorDefinition ? (
        <CatalogCredentialModal
          connectorDefinition={credentialModalTarget.connectorDefinition}
          onSave={handleCredentialSave}
          onClose={() => setCredentialModalTarget(null)}
        />
      ) : credentialModalTarget ? (
        <ConnectorCredentialModal
          connector={
            credentialModalTarget.suggestedConnector ?? {
              name: credentialModalTarget.connectorName,
            }
          }
          connectorDefinition={undefined}
          existingCredential={undefined}
          onSave={handleCredentialSave}
          onClose={() => setCredentialModalTarget(null)}
        />
      ) : null}
    </div>
  );
}
