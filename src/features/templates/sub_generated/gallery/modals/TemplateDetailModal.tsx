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
} from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import { useTier } from '@/hooks/utility/interaction/useTier';
import { PromptTabsPreview } from '@/features/shared/components/editors/PromptTabsPreview';
import { DesignConnectorGrid } from '@/features/shared/components/display/DesignConnectorGrid';
import { BaseModal } from '../../shared/BaseModal';
import { TabTransition } from '../../shared/TabTransition';
import { PersonaMatrix } from '../matrix/PersonaMatrix';
import { computeDifficulty, estimateSetupMinutes, DIFFICULTY_META } from '../../shared/templateComplexity';
import { useTemplatesTranslation } from '@/features/templates/i18n/useTemplatesTranslation';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import type { UseCaseFlow } from '@/lib/types/frontendTypes';
import { parseJsonSafe } from '@/lib/utils/parseJson';
import { getCachedDesignResult } from '../cards/reviewParseCache';
import { OverviewTab } from './OverviewTab';

type DetailTab = 'overview' | 'prompt' | 'connectors';

function useTabConfig() {
  const { t } = useTranslation();
  return [
    { key: 'overview' as DetailTab, label: t.templates.detail.tab_overview, icon: Eye },
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
  const { t: tpl } = useTemplatesTranslation();
  const [activeTab, setActiveTab] = useState<DetailTab>('overview');
  const TAB_CONFIG = useTabConfig();

  const handleTabKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const keys = TAB_CONFIG.map(t => t.key);
    const idx = keys.indexOf(activeTab);
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
  }, [activeTab]);

  const difficulty = useMemo(() => review ? computeDifficulty(review) : null, [review]);
  const difficultyMeta = difficulty ? DIFFICULTY_META[difficulty] : null;
  const setupMinutes = useMemo(() => review ? estimateSetupMinutes(review) : null, [review]);

  if (!isOpen || !review) return null;

  const designResult = getCachedDesignResult(review);
  const flows = parseJsonSafe<UseCaseFlow[]>(review.use_case_flows, []);
  const adjustment = parseJsonSafe<{
    suggestion: string;
    reason: string;
    appliedFixes: string[];
  } | null>(review.suggested_adjustment, null);

  const statusBadge = {
    passed: { Icon: CheckCircle2, color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20', label: t.templates.detail.review_passed },
    failed: { Icon: XCircle, color: 'text-red-400 bg-red-500/10 border-red-500/20', label: t.templates.detail.review_failed },
    error: { Icon: AlertTriangle, color: 'text-amber-400 bg-amber-500/10 border-amber-500/20', label: t.templates.detail.review_error },
  }[review.status] || { Icon: Clock, color: 'text-foreground bg-secondary/30 border-primary/10', label: review.status };

  const StatusIcon = statusBadge.Icon;

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      titleId="template-detail-title"
      maxWidthClass="max-w-7xl"
      containerClassName="absolute inset-0 z-50 flex items-center justify-center p-4"
      panelClassName="h-full max-h-full bg-background border border-primary/10 rounded-2xl shadow-elevation-4 flex flex-col overflow-hidden"
    >
        {/* Header with gradient accent */}
        <div className="relative flex-shrink-0 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-violet-500/8 via-indigo-500/5 to-transparent pointer-events-none" />
          <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-violet-500/30 via-indigo-500/15 to-transparent" />
          <div className="relative px-8 py-5 flex items-start justify-between gap-6">
            <div className="min-w-0 flex-1">
              <h2 id="template-detail-title" className="typo-heading-lg font-semibold text-foreground tracking-tight">
                {review.test_case_name}
              </h2>
              <p className="typo-body text-foreground mt-1.5 line-clamp-2 max-w-3xl leading-relaxed">
                {review.instruction}
              </p>
              <div className="flex items-center gap-3 mt-3">
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 typo-body font-medium rounded-card border ${statusBadge.color}`}>
                  <StatusIcon className="w-3.5 h-3.5" />
                  {statusBadge.label}
                </span>
                {!isSimple && review.adoption_count > 0 && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 typo-body font-medium rounded-card bg-emerald-500/10 border border-emerald-500/15 text-emerald-400/80">
                    <Download className="w-3.5 h-3.5" />
                    {t.templates.detail_modal.adopted.replace('{count}', String(review.adoption_count))}
                  </span>
                )}
                {difficultyMeta && difficulty && (
                  <span
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 typo-body font-medium rounded-card border ${difficultyMeta.bgClass}`}
                    title={`${tpl.complexity[difficulty]}${setupMinutes ? ` · ${tpl.complexity.minuteSetup.replace('{minutes}', String(setupMinutes))}` : ''}`}
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
                  </span>
                )}
                {!isSimple && review.had_references && (
                  <span className="typo-body text-violet-400/60 flex items-center gap-1.5 font-medium">
                    <span className="w-2 h-2 rounded-full bg-violet-400/50 ring-2 ring-violet-400/20" />
                    {t.templates.detail_modal.reference_patterns}
                  </span>
                )}
              </div>
            </div>
            <Button onClick={onClose} variant="ghost" size="icon-sm" className="flex-shrink-0 hover:bg-white/5">
              <X className="w-5 h-5 text-foreground hover:text-muted-foreground" />
            </Button>
          </div>
        </div>

        {/* Tabs with accent underline */}
        <div
          role="tablist"
          aria-label={t.templates.gallery.template_details_tabs_aria}
          onKeyDown={handleTabKeyDown}
          className="px-8 border-b border-primary/8 flex gap-1 flex-shrink-0 bg-secondary/20"
        >
          {TAB_CONFIG.map((tab) => {
            const TabIcon = tab.icon;
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                role="tab"
                id={`tab-${tab.key}`}
                aria-selected={isActive}
                aria-controls={`tabpanel-${tab.key}`}
                tabIndex={isActive ? 0 : -1}
                data-tab={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`relative flex items-center gap-2 px-4 py-3 typo-body font-medium transition-colors rounded-t-lg ${
                  isActive
                    ? 'text-violet-300'
                    : 'text-foreground hover:text-muted-foreground/80 hover:bg-white/3'
                }`}
              >
                <TabIcon className={`w-4 h-4 ${isActive ? 'text-violet-400/80' : ''}`} />
                {tab.label}
                {isActive && (
                  <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-gradient-to-r from-violet-500/80 to-indigo-500/60 rounded-full" />
                )}
              </button>
            );
          })}
        </div>

        {/* Content — min-h-0 lets flex-1 shrink below intrinsic content size
            on small viewports so overflow-y-auto actually takes effect */}
        <div
          role="tabpanel"
          id={`tabpanel-${activeTab}`}
          aria-labelledby={`tab-${activeTab}`}
          className="flex-1 min-h-0 overflow-y-auto px-8 py-8"
        >
          <TabTransition tabKey={activeTab}>
            {activeTab === 'overview' && (
              <OverviewTab
                designResult={designResult}
                flows={flows}
                adjustment={adjustment}
                review={review}
                onViewFlows={() => onViewFlows(review)}
              />
            )}
            {activeTab === 'prompt' && designResult && (
              <PromptTabsPreview designResult={designResult} />
            )}
            {activeTab === 'connectors' && designResult && (
              <div className="space-y-8">
                <PersonaMatrix designResult={designResult} flows={flows} />
                <DesignConnectorGrid designResult={designResult} hideConnectorsTools />
              </div>
            )}
            {!designResult && (
              <div className="flex flex-col items-center justify-center py-20 typo-body text-foreground gap-3">
                <div className="w-12 h-12 rounded-modal bg-secondary/40 border border-primary/10 flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5 text-foreground" />
                </div>
                {t.templates.detail_modal.design_unavailable}
              </div>
            )}
          </TabTransition>
        </div>

        {/* Footer with subtle gradient */}
        <div className="relative flex-shrink-0">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/12 to-transparent" />
          <div className="px-8 py-4 bg-secondary/15">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Button
                  onClick={() => onAdopt(review)}
                  variant="secondary"
                  size="sm"
                  icon={<Download className="w-4 h-4" />}
                  className="bg-violet-500/15 text-violet-300 border border-violet-500/25 hover:bg-violet-500/25 shadow-elevation-3 shadow-violet-500/5"
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
                    className="bg-emerald-500/10 text-emerald-400/80 border border-emerald-500/20 hover:bg-emerald-500/20 shadow-elevation-3 shadow-emerald-500/5"
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
                className="text-red-400/60 hover:text-red-400 hover:bg-red-500/10"
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
