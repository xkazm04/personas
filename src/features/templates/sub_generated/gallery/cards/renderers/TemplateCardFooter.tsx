import { Download, Play, Workflow } from 'lucide-react';
import { DimensionRadial } from '../../../shared/DimensionRadial';
import { BUTTON_VARIANTS } from '@/lib/utils/designTokens';
import type { AgentIR } from '@/lib/types/designTypes';
import type { UseCaseFlow } from '@/lib/types/frontendTypes';

interface TemplateCardFooterProps {
  designResult: AgentIR | null;
  displayFlows: UseCaseFlow[];
  onAdopt: () => void;
  onTryIt: () => void;
  onViewFlows: () => void;
}

export function TemplateCardFooter({
  designResult,
  displayFlows,
  onAdopt,
  onTryIt,
  onViewFlows,
}: TemplateCardFooterProps) {
  return (
    <div className="px-4 py-3.5 border-t border-primary/5 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onAdopt();
          }}
          className={`px-3.5 py-2 typo-body rounded-modal border transition-colors inline-flex items-center gap-1.5 ${BUTTON_VARIANTS.adopt.bg} ${BUTTON_VARIANTS.adopt.text} ${BUTTON_VARIANTS.adopt.border} ${BUTTON_VARIANTS.adopt.hover}`}
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
            className={`px-3.5 py-2 typo-body rounded-modal border transition-colors inline-flex items-center gap-1.5 ${BUTTON_VARIANTS.tryIt.bg} ${BUTTON_VARIANTS.tryIt.text} ${BUTTON_VARIANTS.tryIt.border} ${BUTTON_VARIANTS.tryIt.hover}`}
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
            className="px-2.5 py-1.5 typo-body rounded-modal bg-violet-500/8 text-violet-400/70 hover:bg-violet-500/15 transition-colors inline-flex items-center gap-1.5"
          >
            <Workflow className="w-3.5 h-3.5" />
            {displayFlows.length}
          </button>
        )}
        <DimensionRadial designResult={designResult} size={32} />
      </div>
    </div>
  );
}
