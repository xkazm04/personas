import { useState, useMemo } from 'react';
import {
  X,
  Download,
  Trash2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Play,
} from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { useSimpleMode } from '@/hooks/utility/interaction/useSimpleMode';
import { PromptTabsPreview } from '@/features/shared/components/editors/PromptTabsPreview';
import { DesignConnectorGrid } from '@/features/shared/components/display/DesignConnectorGrid';
import { BaseModal } from '../../shared/BaseModal';
import { TabTransition } from '../../shared/TabTransition';
import { PersonaMatrix } from '../matrix/PersonaMatrix';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import type { UseCaseFlow } from '@/lib/types/frontendTypes';
import { parseJsonSafe } from '@/lib/utils/parseJson';
import { getCachedDesignResult } from '../cards/reviewParseCache';
import { OverviewTab } from './OverviewTab';

type DetailTab = 'overview' | 'prompt' | 'connectors' | 'json';

const TAB_CONFIG: { key: DetailTab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'prompt', label: 'Prompt' },
  { key: 'connectors', label: 'Features' },
  { key: 'json', label: 'Raw JSON' },
];

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
  const isSimple = useSimpleMode();
  const [activeTab, setActiveTab] = useState<DetailTab>('overview');

  const visibleTabs = useMemo(
    () => isSimple ? TAB_CONFIG.filter((t) => t.key !== 'json') : TAB_CONFIG,
    [isSimple],
  );

  if (!isOpen || !review) return null;

  const designResult = getCachedDesignResult(review);
  const flows = parseJsonSafe<UseCaseFlow[]>(review.use_case_flows, []);
  const adjustment = parseJsonSafe<{
    suggestion: string;
    reason: string;
    appliedFixes: string[];
  } | null>(review.suggested_adjustment, null);

  const statusBadge = {
    passed: { Icon: CheckCircle2, color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20', label: 'Passed' },
    failed: { Icon: XCircle, color: 'text-red-400 bg-red-500/10 border-red-500/20', label: 'Failed' },
    error: { Icon: AlertTriangle, color: 'text-amber-400 bg-amber-500/10 border-amber-500/20', label: 'Error' },
  }[review.status] || { Icon: Clock, color: 'text-muted-foreground bg-secondary/30 border-primary/10', label: review.status };

  const StatusIcon = statusBadge.Icon;

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      titleId="template-detail-title"
      maxWidthClass="max-w-4xl"
      panelClassName="max-h-[85vh] bg-background border border-primary/15 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
    >
        {/* Header */}
        <div className="px-6 py-4 border-b border-primary/10 flex items-start justify-between gap-4 flex-shrink-0">
          <div className="min-w-0 flex-1">
            <h2 id="template-detail-title" className="text-lg font-semibold text-foreground/90 truncate">
              {review.test_case_name}
            </h2>
            <p className="text-sm text-muted-foreground/70 mt-1 line-clamp-2">
              {review.instruction}
            </p>
            <div className="flex items-center gap-3 mt-2">
              <span className={`inline-flex items-center gap-1 px-2 py-1 text-sm rounded-full border ${statusBadge.color}`}>
                <StatusIcon className="w-3 h-3" />
                {statusBadge.label}
              </span>
              {!isSimple && review.adoption_count > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-1 text-sm rounded-full bg-emerald-500/10 border border-emerald-500/15 text-emerald-400/70">
                  <Download className="w-3 h-3" />
                  {review.adoption_count} adopted
                </span>
              )}
              {!isSimple && review.had_references && (
                <span className="text-sm text-violet-400/50 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-violet-400/40" />
                  Used reference patterns
                </span>
              )}
            </div>
          </div>
          <Button onClick={onClose} variant="ghost" size="icon-sm" className="flex-shrink-0">
            <X className="w-5 h-5 text-muted-foreground/70" />
          </Button>
        </div>

        {/* Tabs */}
        <div className="px-6 border-b border-primary/10 flex gap-0 flex-shrink-0">
          {visibleTabs.map((tab) => (
            <Button
              key={tab.key}
              variant="ghost"
              size="sm"
              onClick={() => setActiveTab(tab.key)}
              className={`relative ${
                activeTab === tab.key
                  ? 'text-violet-300'
                  : 'text-muted-foreground/80 hover:text-foreground/80'
              }`}
            >
              {tab.label}
              {activeTab === tab.key && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-violet-500/70 rounded-full" />
              )}
            </Button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
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
            {activeTab === 'json' && (
              <pre className="p-4 bg-secondary/30 rounded-xl border border-primary/10 text-sm text-muted-foreground/90 overflow-x-auto whitespace-pre-wrap">
                {designResult ? JSON.stringify(designResult, null, 2) : 'No design data available'}
              </pre>
            )}
            {!designResult && activeTab !== 'json' && (
              <div className="flex items-center justify-center py-12 text-sm text-muted-foreground/80">
                Design data unavailable for this template.
              </div>
            )}
          </TabTransition>
        </div>

        {/* Footer -- action buttons */}
        <div className="px-6 py-4 border-t border-primary/10 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Button
                onClick={() => onAdopt(review)}
                variant="secondary"
                size="sm"
                icon={<Download className="w-4 h-4" />}
                className="bg-violet-500/15 text-violet-300 border border-violet-500/25 hover:bg-violet-500/25"
              >
                Adopt as Persona
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
                  className="bg-emerald-500/10 text-emerald-400/80 border border-emerald-500/20 hover:bg-emerald-500/20"
                >
                  Try It
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
              className="text-red-400/70 hover:bg-red-500/10"
            >
              Delete
            </Button>
            )}
          </div>
        </div>
    </BaseModal>
  );
}
