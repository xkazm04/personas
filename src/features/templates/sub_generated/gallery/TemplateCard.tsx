import { useState, useRef, useMemo } from 'react';
import {
  MoreVertical,
  Download,
  Trash2,
  Eye,
  Workflow,
  Clock,
  Webhook,
  MousePointerClick,
  Radio,
  CircleDot,
  Play,
} from 'lucide-react';
import { getConnectorMeta, ConnectorIcon } from '@/features/shared/components/ConnectorMeta';
import { deriveConnectorReadiness } from '../shared/ConnectorReadiness';
import { DimensionRadial } from '../shared/DimensionRadial';
import { TrustBadge } from '../shared/TrustBadge';
import { verifyTemplate } from '@/lib/templates/templateVerification';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import type { DesignAnalysisResult, SuggestedTrigger } from '@/lib/types/designTypes';
import type { UseCaseFlow } from '@/lib/types/frontendTypes';
import { parseJsonSafe } from '@/lib/utils/parseJson';
import { BUTTON_VARIANTS } from '@/lib/utils/designTokens';
import { useTemplateMotion } from '@/features/templates/animationPresets';

const TRIGGER_ICONS: Record<string, typeof Clock> = {
  schedule: Clock,
  webhook: Webhook,
  manual: MousePointerClick,
  polling: Radio,
};

interface TemplateCardProps {
  review: PersonaDesignReview;
  onAdopt: () => void;
  onViewDetails: () => void;
  onDelete: () => void;
  onViewFlows: () => void;
  onTryIt: () => void;
  installedConnectorNames: Set<string>;
  credentialServiceTypes: Set<string>;
}

export function TemplateCard({
  review,
  onAdopt,
  onViewDetails,
  onDelete,
  onViewFlows,
  onTryIt,
  installedConnectorNames,
  credentialServiceTypes,
}: TemplateCardProps) {
  const { motion: MOTION } = useTemplateMotion();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const parsedData = useMemo(() => {
    const connectors = parseJsonSafe<string[]>(review.connectors_used, []);
    const triggerTypes = parseJsonSafe<string[]>(review.trigger_types, []);
    const designResult = parseJsonSafe<DesignAnalysisResult | null>(review.design_result, null);
    const flows = parseJsonSafe<UseCaseFlow[]>(review.use_case_flows, []);
    const displayFlows = flows.length > 0
      ? flows
      : (() => {
          const raw = designResult as unknown as Record<string, unknown> | null;
          return raw?.use_case_flows
            ? parseJsonSafe<UseCaseFlow[]>(JSON.stringify(raw.use_case_flows), [])
            : [];
        })();

    return { connectors, triggerTypes, designResult, displayFlows };
  }, [review.connectors_used, review.trigger_types, review.design_result, review.use_case_flows]);

  const { connectors, triggerTypes, designResult, displayFlows } = parsedData;

  const suggestedTriggers: SuggestedTrigger[] = designResult?.suggested_triggers ?? [];

  const readinessStatuses = designResult?.suggested_connectors
    ? deriveConnectorReadiness(designResult.suggested_connectors, installedConnectorNames, credentialServiceTypes)
    : [];

  const verification = useMemo(() => verifyTemplate({
    testCaseId: review.test_case_id,
    testRunId: review.test_run_id,
    isDesignGenerated: !review.test_run_id.startsWith('seed-'),
    designResultJson: review.design_result,
  }), [review.test_case_id, review.test_run_id, review.design_result]);

  return (
    <div className={`group rounded-xl border border-primary/10 bg-secondary/30 hover:bg-secondary/50 hover:border-primary/15 transition-colors ${MOTION.smooth.css}`}>
      {/* Header */}
      <div className="px-4 pt-4 pb-2.5 flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold text-foreground/90 truncate">
              {review.test_case_name}
            </h3>
            <TrustBadge trustLevel={verification.trustLevel} compact />
          </div>
          <p className="text-sm text-muted-foreground/70 mt-1 line-clamp-2 leading-relaxed">
            {review.instruction.length > 120
              ? review.instruction.slice(0, 120) + '...'
              : review.instruction}
          </p>
        </div>
        <div ref={menuRef} className="relative flex-shrink-0">
          {menuOpen && <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen(!menuOpen);
            }}
            className={`p-1 rounded-md opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-secondary/60 transition-all ${MOTION.snappy.css}`}
          >
            <MoreVertical className="w-4.5 h-4.5 text-muted-foreground/80" />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full mt-1 z-50 min-w-[160px] py-1.5 bg-background border border-primary/20 rounded-lg shadow-2xl backdrop-blur-sm">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen(false);
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
                  setMenuOpen(false);
                  onDelete();
                }}
                className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm transition-colors text-left ${BUTTON_VARIANTS.delete.text} ${BUTTON_VARIANTS.delete.hover}`}
              >
                <Trash2 className="w-4 h-4" />
                Delete
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Compact Body (mobile) */}
      <div className="px-4 py-3 md:hidden border-t border-primary/5 space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground/60">Use Cases</span>
          <span className="text-foreground/80">{displayFlows.length}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground/60">Connectors</span>
          <span className="text-foreground/80">{connectors.length}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground/60">Triggers</span>
          <span className="text-foreground/80">{suggestedTriggers.length > 0 ? suggestedTriggers.length : triggerTypes.length}</span>
        </div>
      </div>

      {/* 3-Column Body */}
      <div className="hidden md:grid px-4 py-4 md:grid-cols-2 lg:grid-cols-3 gap-4 border-t border-primary/5">
        {/* Use Cases */}
        <div className="min-w-0">
          <h4 className="text-sm uppercase tracking-wider text-muted-foreground/50 font-medium mb-2">
            Use Cases
          </h4>
          {displayFlows.length > 0 ? (
            <div className="space-y-1.5">
              {displayFlows.slice(0, 4).map((flow) => (
                <button
                  key={flow.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    onViewFlows();
                  }}
                  className="flex items-center gap-2 w-full text-left group/flow hover:text-violet-300 transition-colors"
                >
                  <CircleDot className="w-3 h-3 text-violet-400/60 flex-shrink-0" />
                  <span className="text-sm text-foreground/70 group-hover/flow:text-violet-300 truncate">
                    {flow.name}
                  </span>
                </button>
              ))}
              {displayFlows.length > 4 && (
                <span className="text-sm text-muted-foreground/50 pl-5">
                  +{displayFlows.length - 4} more
                </span>
              )}
            </div>
          ) : (
            <span className="text-sm text-muted-foreground/40 italic">No flows</span>
          )}
        </div>

        {/* Connectors */}
        <div className="min-w-0">
          <h4 className="text-sm uppercase tracking-wider text-muted-foreground/50 font-medium mb-2">
            Connectors
          </h4>
          {connectors.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {connectors.map((c) => {
                const meta = getConnectorMeta(c);
                const status = readinessStatuses.find((s) => s.connector_name === c);
                const isReady = status?.health === 'ready';
                return (
                  <div
                    key={c}
                    className={`w-8 h-8 rounded-lg flex items-center justify-center transition-opacity ${
                      isReady ? '' : 'opacity-30 grayscale'
                    }`}
                    style={{ backgroundColor: `${meta.color}18` }}
                    title={`${meta.label}${isReady ? '' : ' (not configured)'}`}
                  >
                    <ConnectorIcon meta={meta} size="w-4.5 h-4.5" />
                  </div>
                );
              })}
            </div>
          ) : (
            <span className="text-sm text-muted-foreground/40 italic">None</span>
          )}
        </div>

        {/* Triggers */}
        <div className="min-w-0">
          <h4 className="text-sm uppercase tracking-wider text-muted-foreground/50 font-medium mb-2">
            Triggers
          </h4>
          {(triggerTypes.length > 0 || suggestedTriggers.length > 0) ? (
            <div className="space-y-1.5">
              {(suggestedTriggers.length > 0 ? suggestedTriggers : triggerTypes.map((t) => ({ trigger_type: t, description: t, config: {} }))).slice(0, 3).map((trigger, i) => {
                const TriggerIcon = TRIGGER_ICONS[trigger.trigger_type] ?? Clock;
                return (
                  <div key={i} className="flex items-center gap-2">
                    <TriggerIcon className="w-3.5 h-3.5 text-blue-400/60 flex-shrink-0" />
                    <span className="text-sm text-foreground/70 truncate">
                      {trigger.description || trigger.trigger_type}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <span className="text-sm text-muted-foreground/40 italic">None</span>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 py-3.5 border-t border-primary/5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onAdopt();
            }}
            className={`px-3.5 py-2 text-sm rounded-lg border transition-colors inline-flex items-center gap-1.5 ${BUTTON_VARIANTS.adopt.bg} ${BUTTON_VARIANTS.adopt.text} ${BUTTON_VARIANTS.adopt.border} ${BUTTON_VARIANTS.adopt.hover}`}
          >
            <Download className="w-3.5 h-3.5" />
            Adopt
          </button>
          {designResult && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onTryIt();
              }}
              className={`px-3.5 py-2 text-sm rounded-lg border transition-colors inline-flex items-center gap-1.5 ${BUTTON_VARIANTS.tryIt.bg} ${BUTTON_VARIANTS.tryIt.text} ${BUTTON_VARIANTS.tryIt.border} ${BUTTON_VARIANTS.tryIt.hover}`}
            >
              <Play className="w-3.5 h-3.5" />
              Try It
            </button>
          )}
        </div>
        <div className="flex items-center gap-2.5">
          {displayFlows.length > 0 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onViewFlows();
              }}
              className="px-2.5 py-1.5 text-sm rounded-md bg-violet-500/8 text-violet-400/70 hover:bg-violet-500/15 transition-colors inline-flex items-center gap-1.5"
            >
              <Workflow className="w-3.5 h-3.5" />
              {displayFlows.length}
            </button>
          )}
          <DimensionRadial designResult={designResult} size={32} />
        </div>
      </div>
    </div>
  );
}
