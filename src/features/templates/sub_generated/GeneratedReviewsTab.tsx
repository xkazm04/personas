import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { motion } from 'framer-motion';
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
  Webhook,
  MousePointerClick,
  Radio,
  GitFork,
  Plug,
  Bell,
  Wrench,
  TrendingUp,
} from 'lucide-react';
import { getConnectorMeta, ConnectorIcon } from '@/features/shared/components/ConnectorMeta';
import { usePersonaStore } from '@/stores/personaStore';
import { useTemplateGallery } from '@/hooks/design/useTemplateGallery';
import { deleteDesignReview, cleanupDuplicateReviews } from '@/api/reviews';
import { deriveConnectorReadiness } from './ConnectorReadiness';
import { TemplateSearchBar } from './TemplateSearchBar';
import { TemplatePagination } from './TemplatePagination';
import { TemplateDetailModal } from './TemplateDetailModal';
import { CreateTemplateModal } from './CreateTemplateModal';
import { ADOPT_CONTEXT_KEY } from './useAdoptReducer';
import AdoptionWizardModal from './AdoptionWizardModal';
import { RebuildModal } from './RebuildModal';
import { TemplatePreviewModal } from './TemplatePreviewModal';
import { DimensionRadial } from './DimensionRadial';
import { useModalStack } from './useModalStack';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import type { DesignAnalysisResult, SuggestedTrigger, SuggestedConnector } from '@/lib/types/designTypes';
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


const TRIGGER_ICONS: Record<string, typeof Clock> = {
  schedule: Clock,
  webhook: Webhook,
  manual: MousePointerClick,
  polling: Radio,
};

const NODE_TYPE_DISPLAY: Record<string, {
  Icon: typeof Clock;
  color: string;
  label: string;
}> = {
  action:    { Icon: Wrench,        color: 'text-blue-400 bg-blue-500/10 border-blue-500/15',       label: 'action' },
  decision:  { Icon: GitFork,       color: 'text-amber-400 bg-amber-500/10 border-amber-500/15',    label: 'decision' },
  connector: { Icon: Plug,          color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/15', label: 'connector' },
  event:     { Icon: Radio,         color: 'text-violet-400 bg-violet-500/10 border-violet-500/15',  label: 'event' },
  error:     { Icon: AlertTriangle, color: 'text-rose-400 bg-rose-500/10 border-rose-500/15',       label: 'error' },
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
        <MoreVertical className="w-4.5 h-4.5 text-muted-foreground/90" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 min-w-[180px] py-1.5 bg-background border border-primary/20 rounded-lg shadow-2xl backdrop-blur-sm">
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
  installedConnectorNames,
  credentialServiceTypes,
  onViewFlows,
  onAdopt,
  onTryIt,
}: {
  review: PersonaDesignReview;
  designResult: DesignAnalysisResult | null;
  installedConnectorNames: Set<string>;
  credentialServiceTypes: Set<string>;
  onViewFlows: () => void;
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

  const connectors: string[] = parseJsonSafe(review.connectors_used, []);
  const suggestedTriggers: SuggestedTrigger[] = designResult?.suggested_triggers ?? [];

  const readinessStatuses = designResult?.suggested_connectors
    ? deriveConnectorReadiness(designResult.suggested_connectors, installedConnectorNames, credentialServiceTypes)
    : [];

  const eventCount = designResult?.suggested_event_subscriptions?.length ?? 0;
  const channelCount = designResult?.suggested_notification_channels?.length ?? 0;

  // Per-flow node type statistics for hero cards
  const perFlowStats = useMemo(
    () =>
      displayFlows.map((flow) => {
        const counts: Record<string, number> = {};
        for (const node of flow.nodes) {
          if (node.type !== 'start' && node.type !== 'end') {
            counts[node.type] = (counts[node.type] ?? 0) + 1;
          }
        }
        return counts;
      }),
    [displayFlows],
  );

  // Total human-in-loop decisions across all flows
  const totalDecisions = useMemo(
    () =>
      displayFlows.reduce(
        (sum, flow) => sum + flow.nodes.filter((n) => n.type === 'decision').length,
        0,
      ),
    [displayFlows],
  );

  return (
    <div className="space-y-3">
      {/* ── Section A: Header bar — summary + metadata rail ── */}
      <div className="flex items-start gap-4">
        {/* Left: summary text */}
        <p className="flex-1 min-w-0 text-sm text-foreground/80 leading-relaxed">
          {designResult?.summary || review.instruction}
        </p>

        {/* Right: metadata rail */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Connector icon cluster */}
          {connectors.length > 0 && (
            <div className="flex items-center gap-1">
              {connectors.map((c) => {
                const meta = getConnectorMeta(c);
                const status = readinessStatuses.find((s) => s.connector_name === c);
                const isReady = status?.health === 'ready';
                return (
                  <div
                    key={c}
                    className="relative flex-shrink-0"
                    title={`${meta.label}${isReady ? '' : ' (needs setup)'}`}
                  >
                    <div
                      className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all ${
                        isReady ? '' : 'grayscale'
                      }`}
                      style={{ backgroundColor: `${meta.color}18` }}
                    >
                      <ConnectorIcon meta={meta} size="w-4 h-4" />
                    </div>
                    <span
                      className={`absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full ${
                        isReady ? 'bg-emerald-500' : 'bg-amber-500/60'
                      }`}
                    />
                  </div>
                );
              })}
            </div>
          )}

          {/* Divider */}
          {connectors.length > 0 && suggestedTriggers.length > 0 && (
            <div className="w-px h-5 bg-primary/10" />
          )}

          {/* Trigger pills */}
          {suggestedTriggers.length > 0 && (
            <div className="flex items-center gap-1">
              {suggestedTriggers.map((trigger, i) => {
                const TriggerIcon = TRIGGER_ICONS[trigger.trigger_type] ?? Clock;
                return (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-mono uppercase rounded bg-blue-500/8 text-blue-400/70 border border-blue-500/12"
                    title={trigger.description}
                  >
                    <TriggerIcon className="w-2.5 h-2.5" />
                    {trigger.trigger_type}
                  </span>
                );
              })}
            </div>
          )}

          {/* Count badges */}
          {eventCount > 0 && (
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-mono rounded bg-rose-500/8 text-rose-400/70 border border-rose-500/12"
              title={`${eventCount} event subscription${eventCount !== 1 ? 's' : ''}`}
            >
              <Radio className="w-2.5 h-2.5" />
              {eventCount}
            </span>
          )}
          {channelCount > 0 && (
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-mono rounded bg-purple-500/8 text-purple-400/70 border border-purple-500/12"
              title={`${channelCount} notification channel${channelCount !== 1 ? 's' : ''}`}
            >
              <Bell className="w-2.5 h-2.5" />
              {channelCount}
            </span>
          )}
          {totalDecisions > 0 && (
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-mono rounded bg-amber-500/8 text-amber-400/70 border border-amber-500/12"
              title={`${totalDecisions} human-in-loop decision${totalDecisions !== 1 ? 's' : ''}`}
            >
              <GitFork className="w-2.5 h-2.5" />
              {totalDecisions}
            </span>
          )}

          {/* Quality radial */}
          <DimensionRadial designResult={designResult} size={36} className="flex-shrink-0" />
        </div>
      </div>

      {/* ── Section B: Use Case Hero Cards ── */}
      {displayFlows.length > 0 ? (
        <div className="grid grid-cols-2 gap-3">
          {displayFlows.map((flow, idx) => {
            const stats = perFlowStats[idx] ?? {};
            return (
              <motion.button
                key={flow.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.05, duration: 0.2 }}
                onClick={onViewFlows}
                className="group/card text-left p-3.5 rounded-xl bg-secondary/25 border border-primary/8 hover:border-violet-500/20 hover:bg-violet-500/5 transition-all"
              >
                {/* Card header */}
                <div className="flex items-start gap-2 mb-1.5">
                  <Workflow className="w-3.5 h-3.5 text-violet-400/50 flex-shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <span className="text-sm font-medium text-foreground/85 group-hover/card:text-violet-300 block truncate">
                      {flow.name}
                    </span>
                    {flow.description && (
                      <span className="text-xs text-muted-foreground/50 block line-clamp-2 leading-relaxed mt-0.5">
                        {flow.description}
                      </span>
                    )}
                  </div>
                </div>

                {/* Separator */}
                <div className="border-t border-primary/6 my-2" />

                {/* Node type pills */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  {Object.entries(stats).map(([type, count]) => {
                    const display = NODE_TYPE_DISPLAY[type];
                    if (!display) return null;
                    const { Icon, color } = display;
                    return (
                      <span
                        key={type}
                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-mono rounded border ${color}`}
                      >
                        <Icon className="w-2.5 h-2.5" />
                        {count} {display.label}{count !== 1 ? 's' : ''}
                      </span>
                    );
                  })}
                  {Object.keys(stats).length === 0 && (
                    <span className="text-[10px] text-muted-foreground/30 italic">No steps</span>
                  )}
                </div>
              </motion.button>
            );
          })}
        </div>
      ) : (
        <div className="py-4 text-center text-sm text-muted-foreground/40 italic">
          No use case flows defined
        </div>
      )}

      {/* ── Section C: Action Row ── */}
      <div className="flex items-center justify-between pt-1">
        <div className="flex items-center gap-2">
          <button
            onClick={onAdopt}
            className="px-5 py-2.5 text-sm rounded-xl bg-violet-500/15 text-violet-300 border border-violet-500/25 hover:bg-violet-500/25 transition-colors flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            Adopt as Persona
          </button>
          {designResult && (
            <button
              onClick={onTryIt}
              className="px-5 py-2.5 text-sm rounded-xl bg-emerald-500/10 text-emerald-400/80 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors flex items-center gap-2"
            >
              <Play className="w-4 h-4" />
              Try It
            </button>
          )}
        </div>
        {displayFlows.length > 0 && (
          <button
            onClick={onViewFlows}
            className="px-4 py-2 text-sm rounded-lg bg-violet-500/8 text-violet-400/70 hover:bg-violet-500/15 transition-colors inline-flex items-center gap-1.5"
          >
            <Workflow className="w-3.5 h-3.5" />
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
        coverageFilter={gallery.coverageFilter}
        onCoverageFilterChange={gallery.setCoverageFilter}
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
      <div className="flex-1 overflow-y-auto overflow-x-auto">
        {gallery.items.length > 0 ? (
          <table className="w-full" style={{ minWidth: 960 }}>
            <thead className="sticky top-0 z-10">
              <tr className="bg-background border-b border-primary/10" style={{ backgroundColor: 'hsl(var(--background))' }}>
                <th className="text-left text-sm font-medium text-muted-foreground/70 px-6 py-3 w-10 bg-secondary/80" />
                <th className="text-left text-sm font-medium text-muted-foreground/70 px-4 py-3 bg-secondary/80">Template Name</th>
                <th className="text-center text-sm font-medium text-muted-foreground/70 px-4 py-3 bg-secondary/80">Flows</th>
                <th className="text-center text-sm font-medium text-muted-foreground/70 px-4 py-3 bg-secondary/80">Quality</th>
                <th className="text-center text-sm font-medium text-muted-foreground/70 px-4 py-3 bg-secondary/80">Status</th>
                <th className="text-right text-sm font-medium text-muted-foreground/70 px-6 py-3 w-28 bg-secondary/80" />
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
                        <div>
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
                          <span className="text-sm text-muted-foreground/60 block truncate max-w-[500px]">
                            {review.instruction.length > 100
                              ? review.instruction.slice(0, 100) + '...'
                              : review.instruction}
                          </span>
                          {/* Connector icons */}
                          {connectors.length > 0 && (
                            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
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
                        {flowCount > 0 ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-300">
                            <Workflow className="w-3.5 h-3.5" />
                            {flowCount}
                          </span>
                        ) : (
                          <span className="text-sm text-muted-foreground/40">--</span>
                        )}
                      </td>
                      <td className="px-4 py-4 text-center">
                        <div className="flex justify-center">
                          <DimensionRadial designResult={designResult} size={32} />
                        </div>
                      </td>
                      <td className="px-4 py-4 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <span
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm rounded-full border ${statusBadge.color}`}
                          >
                            <StatusIcon className="w-3.5 h-3.5" />
                            {statusBadge.label}
                          </span>
                          {review.suggested_adjustment && (
                            <span title="Adjustment suggestion available">
                              <Lightbulb className="w-4 h-4 text-amber-400/60" />
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              modals.open({ type: 'adopt', review });
                            }}
                            className="px-3.5 py-2 text-sm rounded-lg bg-violet-500/15 text-violet-300 border border-violet-500/25 hover:bg-violet-500/25 transition-colors inline-flex items-center gap-1.5"
                          >
                            <Download className="w-3.5 h-3.5" />
                            Adopt
                          </button>
                          <RowActionMenu
                            reviewId={review.id}
                            onDelete={handleDeleteReview}
                            onViewDetails={() => modals.open({ type: 'detail', review })}
                            onRebuild={() => modals.open({ type: 'rebuild', review })}
                          />
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={6} className="px-6 py-4 bg-secondary/20 border-b border-primary/10">
                          <ExpandedRowContent
                            review={review}
                            designResult={designResult}
                            installedConnectorNames={installedConnectorNames}
                            credentialServiceTypes={credentialServiceTypes}
                            onViewFlows={() => onViewFlows(review)}
                            onAdopt={() => modals.open({ type: 'adopt', review })}
                            onTryIt={() => modals.open({ type: 'preview', review })}
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
          <div className="flex items-center justify-center h-40 text-sm text-muted-foreground/60" style={{ minWidth: 960 }}>
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
          onCompleted={() => {
            modals.close('rebuild');
            gallery.refresh();
          }}
        />
      )}

      {/* Template Preview Modal */}
      <TemplatePreviewModal
        isOpen={modals.isOpen('preview')}
        onClose={() => modals.close('preview')}
        review={modals.find('preview')?.review ?? null}
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
