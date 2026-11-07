import { Download, Play, Workflow } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { DimensionRadial } from '../../../shared/DimensionRadial';
import type { AgentIR } from '@/lib/types/designTypes';
import type { UseCaseFlow } from '@/lib/types/frontendTypes';
import Button from '@/features/shared/components/buttons/Button';

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
  const { t } = useTranslation();
  return (
    <div className="px-4 py-3.5 border-t border-hair flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          data-testid="template-adopt-button"
          onClick={(e) => {
            e.stopPropagation();
            onAdopt();
          }}
          variant="primary"
          size="md"
          icon={<Download className="w-3.5 h-3.5" />}
        >
          Adopt
        </Button>
        {designResult && (
          <Button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onTryIt();
            }}
            variant="secondary"
            size="md"
            icon={<Play className="w-3.5 h-3.5" />}
          >
            {t.templates.actions.try_it}
          </Button>
        )}
      </div>
      <div className="flex items-center gap-2.5">
        {displayFlows.length > 0 && (
          <Button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onViewFlows();
            }}
            variant="accent"
            tone="agent"
            size="sm"
            icon={<Workflow className="w-3.5 h-3.5" />}
          >
            {displayFlows.length}
          </Button>
        )}
        <DimensionRadial designResult={designResult} size={32} />
      </div>
    </div>
  );
}
