import { Sparkles, RefreshCw, Play, FileEdit, X, CheckCircle2, AlertTriangle, Ban } from 'lucide-react';
import type { AdoptionDraft } from '@/stores/slices/system/uiSlice';
import { isCliRunSettled, type CliRunPhase } from '@/hooks/execution/useCorrelatedCliStream';
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
              type="button"
              onClick={() => onResumeDraft(adoptionDraft)}
              className="flex-1 flex items-center gap-3 hover:opacity-80 transition-opacity text-left min-w-0"
            >
              <div className="w-7 h-7 rounded-card bg-amber-500/15 flex items-center justify-center flex-shrink-0">
                <FileEdit className="w-4 h-4 text-amber-400" />
              </div>
              <div className="flex-1 min-w-0">
                <span className="typo-body font-medium text-amber-300 block truncate">
                  {t.templates.banners.draft_prefix}{adoptionDraft.templateName}
                </span>
                <span className="typo-body text-foreground">
                  {t.templates.banners.step_click_resume.replace('{step}', ADOPT_STEP_LABELS[adoptionDraft.step] ?? adoptionDraft.step)}
                </span>
              </div>
            </button>
            <button
              type="button"
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
            type="button"
            onClick={onResumeAdoption}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-modal bg-violet-500/8 border border-violet-500/15 hover:bg-violet-500/12 transition-colors text-left"
          >
            <div className="w-7 h-7 rounded-card bg-violet-500/15 flex items-center justify-center flex-shrink-0">
              <Sparkles className="w-4 h-4 text-violet-400 animate-pulse" />
            </div>
            <div className="flex-1 min-w-0">
              <span className="typo-body font-medium text-violet-300 block">{t.templates.banners.adoption_in_progress}</span>
              <span className="typo-body text-foreground">{t.templates.banners.click_to_view_progress}</span>
            </div>
            <div className="w-2 h-2 rounded-full bg-violet-400 animate-pulse flex-shrink-0" />
          </button>
        </div>
      )}

      {/* Background rebuild banner */}
      {rebuildIsActive && !rebuildModalOpen && (
        <div className="mx-4 mt-3 mb-0">
          <button
            type="button"
            onClick={onResumeRebuild}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-modal bg-blue-500/8 border border-blue-500/15 hover:bg-blue-500/12 transition-colors text-left"
          >
            <div className="w-7 h-7 rounded-card bg-blue-500/15 flex items-center justify-center flex-shrink-0">
              <RefreshCw className="w-4 h-4 text-blue-400 animate-spin" />
            </div>
            <div className="flex-1 min-w-0">
              <span className="typo-body font-medium text-blue-300 block">
                {t.templates.banners.rebuilding.replace('{name}', rebuildReviewName ?? 'template')}
              </span>
              <span className="typo-body text-foreground">{t.templates.banners.click_to_view_progress}</span>
            </div>
            <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse flex-shrink-0" />
          </button>
        </div>
      )}

      {/* Background preview banner -- shows for every phase of the run, active
          or terminal. Before the phase vocabulary was completed, a cancelled
          or incomplete preview kept the cyan "Testing" banner with its pulsing
          dot forever, because every non-completed/failed phase fell through to
          the "still running" branch of these ternaries. */}
      {previewIsActive && !previewModalOpen && (() => {
        const isDone = isCliRunSettled(previewPhase);

        const tone =
          previewPhase === 'failed'
            ? 'red'
            : previewPhase === 'completed'
              ? 'emerald'
              : previewPhase === 'cancelled'
                ? 'slate'
                : previewPhase === 'incomplete' || previewPhase === 'unknown'
                  ? 'amber'
                  : 'cyan';

        const bgClass = {
          red: 'bg-red-500/8 border-red-500/15 hover:bg-red-500/12',
          emerald: 'bg-emerald-500/8 border-emerald-500/15 hover:bg-emerald-500/12',
          slate: 'bg-secondary/40 border-primary/10 hover:bg-secondary/60',
          amber: 'bg-amber-500/8 border-amber-500/15 hover:bg-amber-500/12',
          cyan: 'bg-cyan-500/8 border-cyan-500/15 hover:bg-cyan-500/12',
        }[tone];

        const iconBgClass = {
          red: 'bg-red-500/15',
          emerald: 'bg-emerald-500/15',
          slate: 'bg-secondary/60',
          amber: 'bg-amber-500/15',
          cyan: 'bg-cyan-500/15',
        }[tone];

        const textClass = {
          red: 'text-red-300',
          emerald: 'text-emerald-300',
          slate: 'text-foreground',
          amber: 'text-amber-300',
          cyan: 'text-cyan-300',
        }[tone];

        const Icon = {
          red: AlertTriangle,
          emerald: CheckCircle2,
          slate: Ban,
          amber: AlertTriangle,
          cyan: Play,
        }[tone];

        const statusText = {
          red: t.templates.banners.status_failed,
          emerald: t.templates.banners.status_completed,
          slate: t.monitor.status_cancelled,
          amber: t.agents.executions.stopped_while_running,
          cyan: previewPhase === 'queued' ? t.monitor.status_queued : t.templates.banners.status_testing,
        }[tone];

        const subtitleText = isDone
          ? t.templates.banners.click_to_view_result
          : t.templates.banners.click_to_view_output;

        const iconColor = {
          red: 'text-red-400',
          emerald: 'text-emerald-400',
          slate: 'text-foreground',
          amber: 'text-amber-400',
          cyan: 'text-cyan-400',
        }[tone];

        const dotColor = {
          red: 'bg-red-400',
          emerald: 'bg-emerald-400',
          slate: 'bg-secondary',
          amber: 'bg-amber-400',
          cyan: 'bg-cyan-400',
        }[tone];

        return (
          <div className="mx-4 mt-3 mb-0">
            <div className={`w-full flex items-center gap-3 px-4 py-3 rounded-modal border ${bgClass}`}>
              <button
                type="button"
                onClick={onResumePreview}
                className="flex-1 flex items-center gap-3 hover:opacity-80 transition-opacity text-left min-w-0"
              >
                <div className={`w-7 h-7 rounded-card ${iconBgClass} flex items-center justify-center flex-shrink-0`}>
                  <Icon className={`w-4 h-4 ${iconColor} ${!isDone ? 'animate-pulse' : ''}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <span className={`typo-body font-medium ${textClass} block truncate`}>
                    {statusText}: {previewReviewName ?? 'template'}
                  </span>
                  <span className="typo-body text-foreground">{subtitleText}</span>
                </div>
                <div className={`w-2 h-2 rounded-full ${dotColor} ${!isDone ? 'animate-pulse' : ''} flex-shrink-0`} />
              </button>
              {isDone && (
                <button
                  type="button"
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
