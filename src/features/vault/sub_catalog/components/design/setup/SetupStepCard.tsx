import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import {
  CheckCircle,
  Circle,
} from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';

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
  const { t } = useTranslation();
  // Strip the leading number (e.g. "1. " or "2) ")
  const content = stepMarkdown.replace(/^\s*\d+[.)]\s+/, '');

  return (
    <div
      className={`flex gap-2.5 px-3 py-2 rounded-xl transition-colors ${
        isCompleted ? 'bg-emerald-500/5' : 'bg-transparent hover:bg-secondary/20'
      }`}
    >
      {/* Checkmark button */}
      <button
        onClick={onToggle}
        className="mt-0.5 shrink-0 focus-visible:outline-none"
        title={isCompleted ? t.vault.design_phases.mark_not_done : t.vault.design_phases.mark_done}
        aria-label={t.vault.design_phases.mark_step_complete}
      >
        {isCompleted ? (
          <CheckCircle className="w-4 h-4 text-emerald-400" />
        ) : (
          <Circle className="w-4 h-4 text-muted-foreground/80 hover:text-primary/50 transition-colors" />
        )}
      </button>

      {/* Step content */}
      <div className={`flex-1 min-w-0 ${isCompleted ? 'opacity-50' : ''}`}>
        <span className="text-sm font-bold text-muted-foreground/80 uppercase tracking-wider">
          Step {stepIndex + 1}
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
