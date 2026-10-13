// ResourceGlyph - what a line mostly consumes: the dominant axis's icon, and,
// when a live sample gives one, the share drawn as a short fill under it. No
// data, no glyph: a line with nothing measured shows nothing rather than a
// placeholder that would read as "light".

import { memo } from 'react';
import type { ResourceAxis } from '@/lib/bindings/ResourceAxis';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { formatNumeric } from '@/lib/utils/formatters';
import { AXIS_ICON, loadFill, useAxisLabels } from './ResourceBars';

export const ResourceGlyph = memo(function ResourceGlyph({
  axis, share = null,
}: {
  axis: ResourceAxis | null;
  /** The share on `axis` (0..1) from a live sample; `null` for a snapshot's axis alone. */
  share?: number | null;
}) {
  const { t, tx, language } = useTranslation();
  const labels = useAxisLabels();
  if (!axis) return null;
  const Icon = AXIS_ICON[axis];
  const label = share == null
    ? tx(t.monitor.mesh_glyph_axis, { axis: labels[axis] })
    : tx(t.monitor.mesh_glyph_share, { axis: labels[axis], share: formatNumeric(share, 'ratio', { language }) });
  const v = share == null ? null : Math.max(0, Math.min(1, share));
  return (
    <Tooltip content={label} delay={300}>
      <span role="img" aria-label={label} className="inline-flex w-4 flex-shrink-0 flex-col items-center gap-0.5" data-testid="mesh-resource-glyph" data-axis={axis}>
        <Icon className="h-3.5 w-3.5" aria-hidden />
        {v !== null && (
          <span className="relative block h-0.5 w-full overflow-hidden rounded-full bg-foreground/15" aria-hidden>
            <span className={`absolute inset-y-0 left-0 ${loadFill(v)}`} style={{ width: `${Math.max(8, v * 100)}%` }} />
          </span>
        )}
      </span>
    </Tooltip>
  );
});
