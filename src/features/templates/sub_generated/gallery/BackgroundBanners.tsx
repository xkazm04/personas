import { Sparkles, RefreshCw, Play } from 'lucide-react';

interface BackgroundBannersProps {
  /** Whether the template adoption is active in the store */
  templateAdoptActive: boolean;
  /** Whether the adopt modal is currently open */
  adoptModalOpen: boolean;
  /** Resume the adoption wizard */
  onResumeAdoption: () => void;

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
  /** Whether the preview modal is currently open */
  previewModalOpen: boolean;
  /** Name of the template being previewed */
  previewReviewName: string | null;
  /** Open the preview modal for the active preview */
  onResumePreview: () => void;
}

export function BackgroundBanners({
  templateAdoptActive,
  adoptModalOpen,
  onResumeAdoption,
  rebuildIsActive,
  rebuildModalOpen,
  rebuildReviewName,
  onResumeRebuild,
  previewIsActive,
  previewModalOpen,
  previewReviewName,
  onResumePreview,
}: BackgroundBannersProps) {
  return (
    <>
      {/* Background adoption banner */}
      {templateAdoptActive && !adoptModalOpen && (
        <div className="mx-4 mt-3 mb-0">
          <button
            onClick={onResumeAdoption}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-violet-500/8 border border-violet-500/15 hover:bg-violet-500/12 transition-colors text-left"
          >
            <div className="w-7 h-7 rounded-lg bg-violet-500/15 flex items-center justify-center flex-shrink-0">
              <Sparkles className="w-4 h-4 text-violet-400 animate-pulse" />
            </div>
            <div className="flex-1 min-w-0">
              <span className="text-sm font-medium text-violet-300 block">Template adoption in progress</span>
              <span className="text-sm text-muted-foreground/80">Click to view progress</span>
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
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-blue-500/8 border border-blue-500/15 hover:bg-blue-500/12 transition-colors text-left"
          >
            <div className="w-7 h-7 rounded-lg bg-blue-500/15 flex items-center justify-center flex-shrink-0">
              <RefreshCw className="w-4 h-4 text-blue-400 animate-spin" />
            </div>
            <div className="flex-1 min-w-0">
              <span className="text-sm font-medium text-blue-300 block">
                Rebuilding: {rebuildReviewName ?? 'template'}
              </span>
              <span className="text-sm text-muted-foreground/80">Click to view progress</span>
            </div>
            <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse flex-shrink-0" />
          </button>
        </div>
      )}

      {/* Background preview banner */}
      {previewIsActive && !previewModalOpen && (
        <div className="mx-4 mt-3 mb-0">
          <button
            onClick={onResumePreview}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-cyan-500/8 border border-cyan-500/15 hover:bg-cyan-500/12 transition-colors text-left"
          >
            <div className="w-7 h-7 rounded-lg bg-cyan-500/15 flex items-center justify-center flex-shrink-0">
              <Play className="w-4 h-4 text-cyan-400 animate-pulse" />
            </div>
            <div className="flex-1 min-w-0">
              <span className="text-sm font-medium text-cyan-300 block">
                Testing: {previewReviewName ?? 'template'}
              </span>
              <span className="text-sm text-muted-foreground/80">Click to view output</span>
            </div>
            <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse flex-shrink-0" />
          </button>
        </div>
      )}
    </>
  );
}
