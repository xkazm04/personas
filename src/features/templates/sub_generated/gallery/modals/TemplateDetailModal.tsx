import { useState, useCallback } from 'react';
import { useMemo } from 'react';
import {
  X,
  Download,
  Trash2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Play,
  Eye,
  Layers,
  FileCode,
  GraduationCap,
  Workflow,
} from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import { useTier } from '@/hooks/utility/interaction/useTier';
import { PromptTabsPreview } from '@/features/shared/components/editors/PromptTabsPreview';
import { DesignConnectorGrid } from '@/features/shared/components/display/DesignConnectorGrid';
import { BaseModal } from '../../shared/BaseModal';
import { TabTransition } from '../../shared/TabTransition';
import { GlyphGrid } from '@/features/shared/glyph';
import {
  buildChronology,
  buildFlowLookup,
} from '@/features/templates/sub_generated/adoption/chronology/useUseCaseChronology';
import { computeDifficulty, estimateSetupMinutes, DIFFICULTY_META } from '../../shared/templateComplexity';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import type { UseCaseFlow } from '@/lib/types/frontendTypes';
import { parseJsonOrDefault } from '@/lib/utils/parseJson';
import { getCachedDesignResult } from '../cards/reviewParseCache';
import { OverviewTab } from './OverviewTab';
import { UseCasesTab } from './UseCasesTab';
import { Tooltip } from '@/features/shared/components/display/Tooltip';

type DetailTab = 'overview' | 'use_cases' | 'prompt' | 'connectors';

function useTabConfig() {
  const { t } = useTranslation();
  return [
    { key: 'overview' as DetailTab, label: t.templates.detail.tab_overview, icon: Eye },
    { key: 'use_cases' as DetailTab, label: t.templates.detail.tab_use_cases, icon: Workflow },
    { key: 'prompt' as DetailTab, label: t.templates.detail.tab_prompt, icon: FileCode },
    { key: 'connectors' as DetailTab, label: t.templates.detail.tab_features, icon: Layers },
  ];
}

interface TemplateDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  review: PersonaDesignReview | null;
  onAdopt: (review: PersonaDesignReview) => void;
  onDelete: (id: string) => void;
  onViewFlows: (review: PersonaDesignReview) => void;
  onTryIt: (review: PersonaDesignReview) => void;
}

export function TemplateDetailModal({
  isOpen,
  onClose,
  review,
  onAdopt,
  onDelete,
  onViewFlows,
  onTryIt,
}: TemplateDetailModalProps) {
  const { t } = useTranslation();
  const { isStarter: isSimple } = useTier();
  const tpl = t.templates;
  const [activeTab, setActiveTab] = useState<DetailTab>('overview');
  const TAB_CONFIG = useTabConfig();

  const flows = useMemo(
    () => (review ? parseJsonOrDefault<UseCaseFlow[]>(review.use_case_flows, []) : []),
    [review],
  );
  // Hide the use-cases tab when the template has no flows; if the active tab
  // disappears (review switched under an open modal), fall back to overview.
  const visibleTabs = useMemo(
    () => (flows.length > 0 ? TAB_CONFIG : TAB_CONFIG.filter((tab) => tab.key !== 'use_cases')),
    [TAB_CONFIG, flows.length],
  );
  const effectiveTab: DetailTab = visibleTabs.some((tab) => tab.key === activeTab) ? activeTab : 'overview';

  const handleTabKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const keys = visibleTabs.map(t => t.key);
    const idx = keys.indexOf(effectiveTab);
    let next: number;

    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = (idx + 1) % keys.length;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        next = (idx - 1 + keys.length) % keys.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = keys.length - 1;
        break;
      default:
        return;
    }

    e.preventDefault();
    const nextTab = keys[next]!;
    setActiveTab(nextTab);
    const target = e.currentTarget.querySelector<HTMLElement>(`[data-tab="${nextTab}"]`);
    target?.focus();
  }, [visibleTabs, effectiveTab]);

  const difficulty = useMemo(() => review ? computeDifficulty(review) : null, [review]);
  const difficultyMeta = difficulty ? DIFFICULTY_META[difficulty] : null;
  const setupMinutes = useMemo(() => review ? estimateSetupMinutes(review) : null, [review]);

  if (!isOpen || !review) return null;

  const designResult = getCachedDesignResult(review);
  const adjustment = parseJsonOrDefault<{
    suggestion: string;
    reason: string;
    appliedFixes: string[];
  } | null>(review.suggested_adjustment, null);

  const statusBadge = {
    passed: { Icon: CheckCircle2, color: 'text-status-success bg-status-success/10 border-status-success/20', label: t.templates.detail.review_passed },
    failed: { Icon: XCircle, color: 'text-status-error bg-status-error/10 border-status-error/20', label: t.templates.detail.review_failed },
    error: { Icon: AlertTriangle, color: 'text-status-warning bg-status-warning/10 border-status-warning/20', label: t.templates.detail.review_error },
  }[review.status] || { Icon: Clock, color: 'text-foreground bg-surface-1 border-hair', label: review.status };

  const StatusIcon = statusBadge.Icon;

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      titleId="template-detail-title"
      maxWidthClass="max-w-7xl"
      containerClassName="absolute inset-0 z-50 flex items-center justify-center p-4"
      panelClassName="h-full max-h-full bg-background border border-hair rounded-card shadow-elevation-4 flex flex-col overflow-hidden"
    >
        {/* Header with gradient accent */}
        <div className="relative flex-shrink-0 overflow-hidden">
          <div className="relative px-8 py-5 flex items-start justify-between gap-6">
            <div className="min-w-0 flex-1">
              <h2 id="template-detail-title" className="typo-heading-lg text-foreground">
                {review.test_case_name}
              </h2>
              <p className="typo-body text-foreground mt-1.5 line-clamp-2 max-w-3xl">
                {review.instruction}
              </p>
              <div className="flex items-center gap-3 mt-3">
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 typo-body rounded-card border ${statusBadge.color}`}>
                  <StatusIcon className="w-3.5 h-3.5" />
                  {statusBadge.label}
                </span>
                {!isSimple && review.adoption_count > 0 && (
                  <span className="inline-flex items-center gap-1.5 typo-body text-status-success">
                    <Download className="w-3.5 h-3.5" />
                    {t.templates.detail_modal.adopted.replace('{count}', String(review.adoption_count))}
                  </span>
                )}
                {difficultyMeta && difficulty && (
                  <Tooltip content={`${tpl.complexity[difficulty]}${setupMinutes ? ` · ${tpl.complexity.minuteSetup.replace('{minutes}', String(setupMinutes))}` : ''}`}><span
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 typo-body rounded-card border ${difficultyMeta.bgClass}`}
                  >
                    <GraduationCap className="w-3.5 h-3.5" />
                    {tpl.complexity[difficulty]}
                    {setupMinutes != null && (
                      <>
                        <span className="opacity-50">·</span>
                        <Clock className="w-3.5 h-3.5" />
                        {tpl.complexity.minuteSetup.replace('{minutes}', String(setupMinutes))}
                      </>
                    )}
                  </span></Tooltip>
                )}
                {!isSimple && review.had_references && (
                  <span className="typo-body text-role-agent/60 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-role-agent/50 ring-2 ring-role-agent/20" />
                    {t.templates.detail_modal.reference_patterns}
                  </span>
                )}
              </div>
            </div>
            <Button onClick={onClose} variant="ghost" size="icon-sm" aria-label={t.common.close} className="flex-shrink-0 hover:bg-white/5">
              <X className="w-5 h-5 text-foreground hover:text-ink-2" aria-hidden="true" />
            </Button>
          </div>
        </div>

        {/* Tabs with accent underline */}
        <div
          role="tablist"
          aria-label={t.templates.gallery.template_details_tabs_aria}
          onKeyDown={handleTabKeyDown}
          className="px-8 border-b border-primary/8 flex gap-1 flex-shrink-0 bg-surface-1"
        >
          {visibleTabs.map((tab) => {
            const TabIcon = tab.icon;
            const isActive = effectiveTab === tab.key;
            return (
              <button
                type="button"
                key={tab.key}
                role="tab"
                id={`tab-${tab.key}`}
                aria-selected={isActive}
                aria-controls={`tabpanel-${tab.key}`}
                tabIndex={isActive ? 0 : -1}
                data-tab={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`relative flex items-center gap-2 px-4 py-3 typo-body transition-colors rounded-t-card ${
                  isActive
                    ? 'text-role-agent'
                    : 'text-foreground hover:text-ink-2 hover:bg-white/3'
                }`}
              >
                <TabIcon className={`w-4 h-4 ${isActive ? 'text-role-agent/80' : ''}`} />
                {tab.label}
                {isActive && (
                  <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-primary rounded-full" />
                )}
              </button>
            );
          })}
        </div>

        {/* Content — min-h-0 lets flex-1 shrink below intrinsic content size
            on small viewports so overflow-y-auto actually takes effect */}
        <div
          role="tabpanel"
          id={`tabpanel-${effectiveTab}`}
          aria-labelledby={`tab-${effectiveTab}`}
          className="flex-1 min-h-0 overflow-y-auto px-8 py-8"
        >
          <TabTransition tabKey={effectiveTab}>
            {effectiveTab === 'overview' && (
              <OverviewTab
                designResult={designResult}
                flows={flows}
                adjustment={adjustment}
                review={review}
                onViewFlows={() => onViewFlows(review)}
              />
            )}
            {effectiveTab === 'use_cases' && (
              <UseCasesTab flows={flows} onViewFlows={() => onViewFlows(review)} />
            )}
            {effectiveTab === 'prompt' && designResult && (
              <PromptTabsPreview designResult={designResult} />
            )}
            {effectiveTab === 'connectors' && designResult && (
              <ConnectorsTabBody designResult={designResult} />
            )}
            {!designResult && effectiveTab !== 'use_cases' && (
              <div className="flex flex-col items-center justify-center py-20 typo-body text-foreground gap-3">
                <div className="w-12 h-12 rounded-modal bg-surface-2 border border-hair flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5 text-foreground" />
                </div>
                {t.templates.detail_modal.design_unavailable}
              </div>
            )}
          </TabTransition>
        </div>

        {/* Footer with subtle gradient */}
        <div className="relative flex-shrink-0">
          <div className="px-8 py-4 bg-secondary/15">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Button
                  onClick={() => onAdopt(review)}
                  variant="secondary"
                  size="sm"
                  icon={<Download className="w-4 h-4" />}
                  className="bg-role-agent/15 text-role-agent border border-role-agent/25 hover:bg-role-agent/25 shadow-elevation-3"
                  data-testid="button-adopt-template"
                >
                  {t.templates.detail_modal.adopt_as_persona}
                </Button>
                {designResult && (
                  <Button
                    onClick={() => {
                      onClose();
                      onTryIt(review);
                    }}
                    variant="secondary"
                    size="sm"
                    icon={<Play className="w-4 h-4" />}
                    className="bg-status-success/10 text-status-success/80 border border-status-success/20 hover:bg-status-success/20 shadow-elevation-3"
                  >
                    {t.templates.detail_modal.try_it}
                  </Button>
                )}
              </div>
              {!isSimple && (
              <Button
                onClick={() => {
                  onDelete(review.id);
                  onClose();
                }}
                variant="danger"
                size="sm"
                icon={<Trash2 className="w-3.5 h-3.5" />}
                className="text-status-error/60 hover:text-status-error hover:bg-status-error/10"
              >
                {t.common.delete}
              </Button>
              )}
            </div>
          </div>
        </div>
    </BaseModal>
  );
}

/** Body of the "connectors" tab — sigil-first per-use-case capability view
 *  (GlyphGrid) followed by the flat connector list (DesignConnectorGrid). */
function ConnectorsTabBody({
  designResult,
}: {
  designResult: import('@/lib/types/designTypes').AgentIR;
}) {
  const ir = designResult as unknown as Record<string, unknown>;
  const { rows, flowsById } = useMemo(() => ({
    rows: buildChronology(ir),
    flowsById: buildFlowLookup(ir),
  }), [ir]);

  return (
    <div className="space-y-6">
      <GlyphGrid rows={rows} flowsById={flowsById} />
      <DesignConnectorGrid designResult={designResult} hideConnectorsTools />
    </div>
  );
}
