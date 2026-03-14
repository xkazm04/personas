import type React from 'react';

interface GhostedCellRendererProps {
  label: string;
  watermark: React.ComponentType<{ className?: string }>;
  watermarkColor: string;
  /** Override watermark opacity class. Defaults to 'opacity-[0.08]' for blueprint state. */
  watermarkOpacity?: string;
}

/**
 * Renders a ghosted (blueprint) cell outline during the progressive matrix build.
 *
 * Shows a faded border outline with a reduced-opacity label and watermark icon,
 * conveying "this cell exists but hasn't been built yet". No content is rendered
 * in the content area -- it appears as an empty placeholder.
 *
 * Used by MatrixCellRenderer when a cell's build status is 'hidden' or 'revealed'.
 */
export function GhostedCellRenderer({ label, watermark: Watermark, watermarkColor, watermarkOpacity = 'opacity-[0.08]' }: GhostedCellRendererProps) {
  return (
    <div className="relative rounded-xl border border-card-border/20 p-4 transition-[opacity,transform,border-color,background-color] duration-500">
      {/* Watermark icon at very low opacity for subtle blueprint hint */}
      <div className="absolute inset-0 overflow-hidden rounded-xl pointer-events-none">
        <div className={`absolute -right-1 -top-1 ${watermarkOpacity}`}>
          <Watermark className={`w-22 h-22 ${watermarkColor}`} />
        </div>
      </div>

      {/* Label -- visible but faded */}
      <div className="mb-2.5 flex items-center gap-2">
        <span className="text-[13px] font-bold uppercase tracking-[0.15em] text-foreground/20">
          {label}
        </span>
      </div>

      {/* Empty content placeholder */}
      <div className="min-h-[52px]" />
    </div>
  );
}
