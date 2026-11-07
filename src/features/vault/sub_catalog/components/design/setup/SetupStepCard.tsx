import ReactMarkdown from 'react-markdown';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import {
  CheckCircle,
  Circle,
} from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import Button from '@/features/shared/components/buttons/Button';

// -- Step card component -----------------------------------------

export function SetupStepCard({
  stepMarkdown,
  stepIndex,
  isCompleted,
  onToggle,
  components,
}: {
  stepMarkdown: string;
  stepIndex: number;
  isCompleted: boolean;
  onToggle: () => void;
  components: Components;
}) {
  const { t, tx } = useTranslation();
  // Strip the leading number (e.g. "1. " or "2) ")
  const content = stepMarkdown.replace(/^\s*\d+[.)]\s+/, '');

  return (
    <div
      className={`flex gap-2.5 px-3 py-2 rounded-modal transition-colors ${
        isCompleted ? 'bg-status-success/5' : 'bg-transparent hover:bg-surface-1'
      }`}
    >
      {/* Checkmark button */}
      <Tooltip content={isCompleted ? t.vault.design_phases.mark_not_done : t.vault.design_phases.mark_done}>
        <Button
          type="button"
          onClick={onToggle}
          variant="ghost"
          size="sm"
          className="mt-0.5 shrink-0"
          aria-label={t.vault.design_phases.mark_step_complete}
          pressed={isCompleted}
        >
          {isCompleted ? (
            <CheckCircle className="w-4 h-4 text-status-success" />
          ) : (
            <Circle className="w-4 h-4 text-foreground hover:text-primary/50 transition-colors" />
          )}
        </Button>
      </Tooltip>

      {/* Step content */}
      <div className={`flex-1 min-w-0 ${isCompleted ? 'opacity-50' : ''}`}>
        <span className="typo-eyebrow text-foreground">
          {tx(t.vault.design_phases.step_number, { n: stepIndex + 1 })}
        </span>
        <div className="prose-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
            {content}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
