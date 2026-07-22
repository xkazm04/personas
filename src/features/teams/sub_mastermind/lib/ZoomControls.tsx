// Zoom cluster (bottom-right): out / in / fit-all. The escape hatch for
// "lost in the canvas" — Fit reframes every island in one click.
import { Maximize2, Minus, Plus } from 'lucide-react';

const COPY = { zoomOut: 'Zoom out', zoomIn: 'Zoom in', fit: 'Fit all projects' };

export function ZoomControls({ onZoomBy, onFit }: {
  onZoomBy: (factor: number) => void;
  onFit: () => void;
}) {
  const btn = (label: string, onClick: () => void, icon: React.ReactNode, testId: string) => (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="p-1.5 rounded-interactive text-foreground/70 hover:text-foreground hover:bg-primary/10 transition-colors focus-ring"
      data-testid={testId}
    >
      {icon}
    </button>
  );
  return (
    <div className="absolute bottom-3 right-3 z-10 inline-flex items-center gap-0.5 p-1 rounded-interactive bg-secondary/70 border border-primary/12 shadow-elevation-2 backdrop-blur-sm">
      {btn(COPY.zoomOut, () => onZoomBy(1 / 1.3), <Minus className="w-4 h-4" aria-hidden />, 'mm-zoom-out')}
      {btn(COPY.zoomIn, () => onZoomBy(1.3), <Plus className="w-4 h-4" aria-hidden />, 'mm-zoom-in')}
      <span className="w-px h-4 bg-primary/15 mx-0.5" aria-hidden />
      {btn(COPY.fit, onFit, <Maximize2 className="w-4 h-4" aria-hidden />, 'mm-zoom-fit')}
    </div>
  );
}
