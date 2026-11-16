import { Sparkles, RefreshCw, Play, FileEdit, X, CheckCircle2, AlertTriangle, Ban } from 'lucide-react';
import type { AdoptionDraft } from '@/stores/slices/system/uiSlice';
import { isCliRunSettled, type CliRunPhase } from '@/hooks/execution/useCorrelatedCliStream';
import { useTranslation } from '@/i18n/useTranslation';
import Button from '@/features/shared/components/buttons/Button';
import { PressSurface } from '@/features/shared/components/buttons/PressSurface';
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
          <div className="w-full flex items-center gap-3 px-4 py-3 rounded-modal bg-status-warning/8 border border-status-warning/15">
            <PressSurface
              onPress={() => onResumeDraft(adoptionDraft)}
              className="flex-1 flex items-center gap-3 min-w-0"
            >
              <div className="w-7 h-7 rounded-card bg-status-warning/15 flex items-center justify-center flex-shrink-0">
                <FileEdit className="w-4 h-4 text-status-warning" />
              </div>
              <div className="flex-1 min-w-0">
                <span className="typo-body text-status-warning block truncate">
                  {t.templates.banners.draft_prefix}{adoptionDraft.templateName}
                </span>
                <span className="typo-body text-foreground">
                  {t.templates.banners.step_click_resume.replace('{step}', ADOPT_STEP_LABELS[adoptionDraft.step] ?? adoptionDraft.step)}
                </span>
              </div>
            </PressSurface>
            <Button
              type="button"
              onClick={onDiscardDraft}
              variant="ghost"
              size="icon-sm"
              tooltip={t.templates.banners.discard_draft} aria-label={t.templates.banners.discard_draft}
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* Background adoption banner */}
      {templateAdoptActive && !adoptModalOpen && (
        <div className="mx-4 mt-3 mb-0">
          <PressSurface
            onPress={onResumeAdoption}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-modal bg-surface-1 border border-hair"
          >
            <div className="w-7 h-7 rounded-card bg-role-agent/15 flex items-center justify-center flex-shrink-0">
              <Sparkles className="w-4 h-4 text-role-agent" />
            </div>
            <div className="flex-1 min-w-0">
              <span className="typo-body text-role-agent block">{t.templates.banners.adoption_in_progress}</span>
              <span className="typo-body text-foreground">{t.templates.banners.click_to_view_progress}</span>
            </div>
            <div className="w-2 h-2 rounded-full bg-role-agent animate-pulse flex-shrink-0" />
          </PressSurface>
        </div>
      )}

      {/* Background rebuild banner */}
      {rebuildIsActive && !rebuildModalOpen && (
        <div className="mx-4 mt-3 mb-0">
          <PressSurface
            onPress={onResumeRebuild}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-modal bg-surface-1 border border-hair"
          >
            <div className="w-7 h-7 rounded-card bg-status-info/15 flex items-center justify-center flex-shrink-0">
              <RefreshCw className="w-4 h-4 text-status-info animate-spin" />
            </div>
            <div className="flex-1 min-w-0">
              <span className="typo-body text-status-info block">
                {t.templates.banners.rebuilding.replace('{name}', rebuildReviewName ?? 'template')}
              </span>
              <span className="typo-body text-foreground">{t.templates.banners.click_to_view_progress}</span>
            </div>
            <div className="w-2 h-2 rounded-full bg-status-info animate-pulse flex-shrink-0" />
          </PressSurface>
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
          red: 'bg-status-error/8 border-status-error/15 hover:bg-status-error/12',
          emerald: 'bg-status-success/8 border-status-success/15 hover:bg-status-success/12',
          slate: 'bg-surface-2 border-hair hover:bg-surface-2',
          amber: 'bg-status-warning/8 border-status-warning/15 hover:bg-status-warning/12',
          cyan: 'bg-role-highlight/8 border-role-highlight/15 hover:bg-role-highlight/12',
        }[tone];

        const iconBgClass = {
          red: 'bg-status-error/15',
          emerald: 'bg-status-success/15',
          slate: 'bg-surface-2',
          amber: 'bg-status-warning/15',
          cyan: 'bg-role-highlight/15',
        }[tone];

        const textClass = {
          red: 'text-status-error',
          emerald: 'text-status-success',
          slate: 'text-foreground',
          amber: 'text-status-warning',
          cyan: 'text-role-highlight',
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
          red: 'text-status-error',
          emerald: 'text-status-success',
          slate: 'text-foreground',
          amber: 'text-status-warning',
          cyan: 'text-role-highlight',
        }[tone];

        const dotColor = {
          red: 'bg-status-error',
          emerald: 'bg-status-success',
          slate: 'bg-secondary',
          amber: 'bg-status-warning',
          cyan: 'bg-role-highlight',
        }[tone];

        return (
          <div className="mx-4 mt-3 mb-0">
            <div className={`w-full flex items-center gap-3 px-4 py-3 rounded-modal border ${bgClass}`}>
              <PressSurface
                onPress={onResumePreview}
                className="flex-1 flex items-center gap-3 min-w-0"
              >
                <div className={`w-7 h-7 rounded-card ${iconBgClass} flex items-center justify-center flex-shrink-0`}>
                  <Icon className={`w-4 h-4 ${iconColor} ${!isDone ? 'animate-pulse' : ''}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <span className={`typo-body ${textClass} block truncate`}>
                    {statusText}: {previewReviewName ?? 'template'}
                  </span>
                  <span className="typo-body text-foreground">{subtitleText}</span>
                </div>
                <div className={`w-2 h-2 rounded-full ${dotColor} ${!isDone ? 'animate-pulse' : ''} flex-shrink-0`} />
              </PressSurface>
              {isDone && (
                <Button
                  type="button"
                  onClick={onDismissPreview}
                  variant="ghost"
                  size="icon-sm"
                  tooltip="Dismiss" aria-label="Dismiss"
                >
                  <X className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>
          </div>
        );
      })()}
    </>
  );
}
