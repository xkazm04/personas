// Zoom cluster (bottom-right): out / in / fit-all, plus a one-shot "Tidy map"
// that arranges projects by connectivity and a single-level Undo. Tidy is the
// escape hatch for a spiral portfolio where integrated apps drifted apart;
// Fit reframes every island in one click.
import { Maximize2, Minus, Plus, Undo2, Wand2 } from 'lucide-react';

import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';

export function ZoomControls({ onZoomBy, onFit, onTidy, onUndo, canUndo }: {
  onZoomBy: (factor: number) => void;
  onFit: () => void;
  onTidy: () => void;
  onUndo: () => void;
  canUndo: boolean;
}) {
  const { t } = useTranslation();
  // `aria-label` names the control, the Tooltip shows the same words on hover
  // AND on keyboard focus. The native `title` this replaced did neither for a
  // keyboard or touch user (golden path P2, docs/concepts/golden-paths/tooltip.md).
  const btn = (label: string, onClick: () => void, icon: React.ReactNode, testId: string) => (
    <Tooltip content={label}>
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        className="p-1.5 rounded-interactive text-foreground/65 hover:text-foreground hover:bg-primary/12 transition-colors focus-ring"
        data-testid={testId}
      >
        {icon}
      </button>
    </Tooltip>
  );
  return (
    <div className="absolute bottom-3 right-3 z-10 inline-flex items-center gap-0.5 p-1 rounded-interactive mm-chrome surface-blur-tooltip">
      {btn(t.mastermind.zoom_out, () => onZoomBy(1 / 1.3), <Minus className="w-4 h-4" aria-hidden />, 'mm-zoom-out')}
      {btn(t.mastermind.zoom_in, () => onZoomBy(1.3), <Plus className="w-4 h-4" aria-hidden />, 'mm-zoom-in')}
      <span className="w-px h-4 mx-0.5 mm-chrome-rule" aria-hidden />
      {btn(t.mastermind.fit_all, onFit, <Maximize2 className="w-4 h-4" aria-hidden />, 'mm-zoom-fit')}
      <span className="w-px h-4 mx-0.5 mm-chrome-rule" aria-hidden />
      {btn(t.mastermind.tidy_tooltip, onTidy, <Wand2 className="w-4 h-4" aria-hidden />, 'mm-tidy')}
      {canUndo && btn(t.mastermind.undo_tidy, onUndo, <Undo2 className="w-4 h-4" aria-hidden />, 'mm-tidy-undo')}
    </div>
  );
}
