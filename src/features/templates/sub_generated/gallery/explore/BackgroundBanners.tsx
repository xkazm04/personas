import { Sparkles, RefreshCw, Play, FileEdit, X, CheckCircle2, AlertTriangle } from 'lucide-react';
import type { AdoptionDraft } from '@/stores/slices/system/uiSlice';
import type { CliRunPhase } from '@/hooks/execution/useCorrelatedCliStream';
import { useTranslation } from '@/i18n/useTranslation';
/** Label map for legacy adoption wizard steps shown in draft resume banners. */
const ADOPT_STEP_LABELS: Record<string, string> = {
  choose: 'Choose', connect: 'Connect', tune: 'Tune', build: 'Build', create: 'Create',
};

interface BackgroundBannersProps {
  /** Whether the template adoption is active in the store */
  templateAdoptActive: boolean;
  /** Whether the adopt modal is currently open */
  adoptModalOpen: boolean;
  /** Resume the adoption wizard */
  onResumeAdoption: () => void;

  /** Saved adoption draft (partial progress) */
  adoptionDraft: AdoptionDraft | null;
  /** Resume from a saved draft */
  onResumeDraft: (draft: AdoptionDraft) => void;
  /** Discard the saved draft */
  onDiscardDraft: () => void;

  /** Background rebuild state */
  rebuildIsActive: boolean;
  /** Whether the rebuild modal is currently open */
  rebuildModalOpen: boolean;
  /** Name of the template being rebuilt */
  rebuildReviewName: string | null;
  /** Open the rebuild modal for the active rebuild */
  onResumeRebuild: () => void;

  /** Background preview state */
  previewIsActive: boolean;
  /** Current phase of the preview execution */
  previewPhase: CliRunPhase;
  /** Whether the preview modal is currently open */
  previewModalOpen: boolean;
  /** Name of the template being previewed */
  previewReviewName: string | null;
  /** Open the preview modal for the active preview */
  onResumePreview: () => void;
  /** Dismiss the completed/failed preview banner */
  onDismissPreview: () => void;
}

export function BackgroundBanners({
  templateAdoptActive,
  adoptModalOpen,
  onResumeAdoption,
  adoptionDraft,
  onResumeDraft,
  onDiscardDraft,
  rebuildIsActive,
  rebuildModalOpen,
  rebuildReviewName,
  onResumeRebuild,
  previewIsActive,
  previewPhase,
  previewModalOpen,
  previewReviewName,
  onResumePreview,
  onDismissPreview,
}: BackgroundBannersProps) {
  const { t } = useTranslation();
  // Don't show draft banner if there's an active adoption or the modal is open
  const showDraftBanner = adoptionDraft && !templateAdoptActive && !adoptModalOpen;

  return (
    <>
      {/* Saved draft banner */}
      {showDraftBanner && (
        <div className="mx-4 mt-3 mb-0">
          <div className="w-full flex items-center gap-3 px-4 py-3 rounded-modal bg-amber-500/8 border border-amber-500/15">
            <button
              onClick={() => onResumeDraft(adoptionDraft)}
              className="flex-1 flex items-center gap-3 hover:opacity-80 transition-opacity text-left min-w-0"
            >
              <div className="w-7 h-7 rounded-card bg-amber-500/15 flex items-center justify-center flex-shrink-0">
                <FileEdit className="w-4 h-4 text-amber-400" />
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium text-amber-300 block truncate">
                  {t.templates.banners.draft_prefix}{adoptionDraft.templateName}
                </span>
                <span className="text-sm text-foreground">
                  {t.templates.banners.step_click_resume.replace('{step}', ADOPT_STEP_LABELS[adoptionDraft.step] ?? adoptionDraft.step)}
                </span>
              </div>
            </button>
            <button
              onClick={onDiscardDraft}
              className="p-1 rounded-card hover:bg-amber-500/15 text-foreground hover:text-amber-400 transition-colors flex-shrink-0"
              title={t.templates.banners.discard_draft}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Background adoption banner */}
      {templateAdoptActive && !adoptModalOpen && (
        <div className="mx-4 mt-3 mb-0">
          <button
            onClick={onResumeAdoption}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-modal bg-violet-500/8 border border-violet-500/15 hover:bg-violet-500/12 transition-colors text-left"
          >
            <div className="w-7 h-7 rounded-card bg-violet-500/15 flex items-center justify-center flex-shrink-0">
              <Sparkles className="w-4 h-4 text-violet-400 animate-pulse" />
            </div>
            <div className="flex-1 min-w-0">
              <span className="text-sm font-medium text-violet-300 block">{t.templates.banners.adoption_in_progress}</span>
              <span className="text-sm text-foreground">{t.templates.banners.click_to_view_progress}</span>
            </div>
            <div className="w-2 h-2 rounded-full bg-violet-400 animate-pulse flex-shrink-0" />
          </button>
        </div>
      )}

      {/* Background rebuild banner */}
      {rebuildIsActive && !rebuildModalOpen && (
        <div className="mx-4 mt-3 mb-0">
          <button
            onClick={onResumeRebuild}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-modal bg-blue-500/8 border border-blue-500/15 hover:bg-blue-500/12 transition-colors text-left"
          >
            <div className="w-7 h-7 rounded-card bg-blue-500/15 flex items-center justify-center flex-shrink-0">
              <RefreshCw className="w-4 h-4 text-blue-400 animate-spin" />
            </div>
            <div className="flex-1 min-w-0">
              <span className="text-sm font-medium text-blue-300 block">
                {t.templates.banners.rebuilding.replace('{name}', rebuildReviewName ?? 'template')}
              </span>
              <span className="text-sm text-foreground">{t.templates.banners.click_to_view_progress}</span>
            </div>
            <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse flex-shrink-0" />
          </button>
        </div>
      )}

      {/* Background preview banner -- shows while running, completed, or failed */}
      {previewIsActive && !previewModalOpen && (() => {
        const isCompleted = previewPhase === 'completed';
        const isFailed = previewPhase === 'failed';
        const isDone = isCompleted || isFailed;

        const bgClass = isFailed
          ? 'bg-red-500/8 border-red-500/15 hover:bg-red-500/12'
          : isCompleted
            ? 'bg-emerald-500/8 border-emerald-500/15 hover:bg-emerald-500/12'
            : 'bg-cyan-500/8 border-cyan-500/15 hover:bg-cyan-500/12';

        const iconBgClass = isFailed
          ? 'bg-red-500/15'
          : isCompleted
            ? 'bg-emerald-500/15'
            : 'bg-cyan-500/15';

        const textClass = isFailed
          ? 'text-red-300'
          : isCompleted
            ? 'text-emerald-300'
            : 'text-cyan-300';

        const Icon = isFailed
          ? AlertTriangle
          : isCompleted
            ? CheckCircle2
            : Play;

        const statusText = isFailed
          ? t.templates.banners.status_failed
          : isCompleted
            ? t.templates.banners.status_completed
            : t.templates.banners.status_testing;

        const subtitleText = isDone
          ? t.templates.banners.click_to_view_result
          : t.templates.banners.click_to_view_output;

        const iconColor = isFailed
          ? 'text-red-400'
          : isCompleted
            ? 'text-emerald-400'
            : 'text-cyan-400';

        const dotColor = isFailed
          ? 'bg-red-400'
          : isCompleted
            ? 'bg-emerald-400'
            : 'bg-cyan-400';

        return (
          <div className="mx-4 mt-3 mb-0">
            <div className={`w-full flex items-center gap-3 px-4 py-3 rounded-modal border ${bgClass}`}>
              <button
                onClick={onResumePreview}
                className="flex-1 flex items-center gap-3 hover:opacity-80 transition-opacity text-left min-w-0"
              >
                <div className={`w-7 h-7 rounded-card ${iconBgClass} flex items-center justify-center flex-shrink-0`}>
                  <Icon className={`w-4 h-4 ${iconColor} ${!isDone ? 'animate-pulse' : ''}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <span className={`text-sm font-medium ${textClass} block truncate`}>
                    {statusText}: {previewReviewName ?? 'template'}
                  </span>
                  <span className="text-sm text-foreground">{subtitleText}</span>
                </div>
                <div className={`w-2 h-2 rounded-full ${dotColor} ${!isDone ? 'animate-pulse' : ''} flex-shrink-0`} />
              </button>
              {isDone && (
                <button
                  onClick={onDismissPreview}
                  className="p-1 rounded-card hover:bg-secondary/40 text-foreground hover:text-foreground/70 transition-colors flex-shrink-0"
                  title="Dismiss"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        );
      })()}
    </>
  );
}
