import {
  ArrowLeft,
  ArrowRight,
  Sparkles,
  RefreshCw,
  Check,
} from 'lucide-react';
import type { N8nPersonaDraft } from '@/api/templates/n8nTransform';

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
  return (
    <div className="flex items-center justify-between px-6 py-3 border-t border-primary/10 bg-secondary/10 flex-shrink-0">
      <button
        onClick={onBack}
        disabled={!canGoBack}
        className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl border border-primary/15 text-muted-foreground/80 hover:bg-secondary/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Back
      </button>

      <div className="flex items-center gap-3">
        {error && step !== 'describe' && (
          <span className="text-sm text-red-400/80 max-w-[300px] truncate">
            {error}
          </span>
        )}

        {step === 'describe' && (
          <button
            onClick={onStartGenerate}
            disabled={!templateName.trim() || !description.trim()}
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-xl border bg-violet-500/15 text-violet-300 border-violet-500/25 hover:bg-violet-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Sparkles className="w-4 h-4" />
            Generate Template
          </button>
        )}

        {step === 'generate' && generatePhase === 'completed' && (
          <button
            onClick={onGoToReview}
            disabled={!draft}
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-xl border bg-violet-500/15 text-violet-300 border-violet-500/25 hover:bg-violet-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <ArrowRight className="w-4 h-4" />
            View Draft
          </button>
        )}

        {step === 'review' && !saved && (
          <button
            onClick={onSaveTemplate}
            disabled={saving || !draft}
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-xl border bg-emerald-500/15 text-emerald-300 border-emerald-500/25 hover:bg-emerald-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? (
              <><RefreshCw className="w-4 h-4 animate-spin" /> Saving...</>
            ) : (
              <><Check className="w-4 h-4" /> Save Template</>
            )}
          </button>
        )}

        {step === 'review' && saved && (
          <span className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-emerald-400">
            <Check className="w-4 h-4" />
            Template Saved
          </span>
        )}
      </div>
    </div>
  );
}
