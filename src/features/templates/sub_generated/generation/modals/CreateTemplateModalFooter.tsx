import {
  ArrowLeft,
  ArrowRight,
  Sparkles,
  RefreshCw,
  Check,
} from 'lucide-react';
import type { N8nPersonaDraft } from '@/api/templates/n8nTransform';
import { useTranslation } from '@/i18n/useTranslation';

interface CreateTemplateModalFooterProps {
  step: string;
  canGoBack: boolean;
  generating: boolean;
  generatePhase: string;
  templateName: string;
  description: string;
  draft: N8nPersonaDraft | null;
  saving: boolean;
  saved: boolean;
  error: string;
  onBack: () => void;
  onStartGenerate: () => void;
  onGoToReview: () => void;
  onSaveTemplate: () => void;
}

export function CreateTemplateModalFooter({
  step,
  canGoBack,
  generatePhase,
  templateName,
  description,
  draft,
  saving,
  saved,
  error,
  onBack,
  onStartGenerate,
  onGoToReview,
  onSaveTemplate,
}: CreateTemplateModalFooterProps) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between px-6 py-3 border-t border-primary/10 bg-secondary/10 flex-shrink-0">
      <button
        onClick={onBack}
        disabled={!canGoBack}
        className="flex items-center gap-2 px-4 py-2 typo-body font-medium rounded-modal border border-primary/15 text-foreground hover:bg-secondary/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        {t.templates.generation.back}
      </button>

      <div className="flex items-center gap-3">
        {error && step !== 'describe' && (
          <span className="typo-body text-red-400/80 max-w-[300px] truncate">
            {error}
          </span>
        )}

        {step === 'describe' && (
          <button
            onClick={onStartGenerate}
            disabled={!templateName.trim() || !description.trim()}
            className="flex items-center gap-2 px-4 py-2.5 typo-body font-medium rounded-modal border bg-violet-500/15 text-violet-300 border-violet-500/25 hover:bg-violet-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Sparkles className="w-4 h-4" />
            {t.templates.generation.generate_template}
          </button>
        )}

        {step === 'generate' && generatePhase === 'completed' && (
          <button
            onClick={onGoToReview}
            disabled={!draft}
            className="flex items-center gap-2 px-4 py-2.5 typo-body font-medium rounded-modal border bg-violet-500/15 text-violet-300 border-violet-500/25 hover:bg-violet-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <ArrowRight className="w-4 h-4" />
            {t.templates.generation.view_draft}
          </button>
        )}

        {step === 'review' && !saved && (
          <button
            onClick={onSaveTemplate}
            disabled={saving || !draft}
            className="flex items-center gap-2 px-4 py-2.5 typo-body font-medium rounded-modal border bg-emerald-500/15 text-emerald-300 border-emerald-500/25 hover:bg-emerald-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? (
              <><RefreshCw className="w-4 h-4 animate-spin" /> {t.templates.generation.saving}</>
            ) : (
              <><Check className="w-4 h-4" /> {t.templates.generation.save_template}</>
            )}
          </button>
        )}

        {step === 'review' && saved && (
          <span className="flex items-center gap-2 px-4 py-2.5 typo-body font-medium text-emerald-400">
            <Check className="w-4 h-4" />
            {t.templates.generation.template_saved}
          </span>
        )}
      </div>
    </div>
  );
}
