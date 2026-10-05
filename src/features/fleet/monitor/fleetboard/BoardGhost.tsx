// BoardGhost — the field's footprint while the first read is in flight: a few
// bays of ghost tiles laid out by the real layout, under chrome that stays put.
// The kit's Ghost is invisible for its first 150ms, so a warm open that lands
// inside that window never flashes a placeholder (loading pattern v2).

import { memo, useMemo } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { Ghost } from '@/features/shared/components/kit';
import { layoutField } from './layout';

const SHAPE = [8, 5, 5, 3, 3, 2, 1, 1].map((count, i) => ({ id: `ghost-${i}`, count }));

export const BoardGhost = memo(function BoardGhost({ width, height }: { width: number; height: number }) {
  const { t } = useTranslation();
  const bays = useMemo(() => layoutField(SHAPE, width, height), [width, height]);
  return (
    <div className="absolute inset-0" aria-busy="true" aria-label={t.monitor.board_loading}>
      {bays.flatMap((bay) => [
        <div key={bay.id} className="absolute" style={{ left: bay.rect.x, top: bay.rect.y + 9, width: bay.rect.w * 0.45 }} aria-hidden>
          <Ghost width="100%" height="12px" />
        </div>,
        ...bay.tiles.map((r, k) => (
          <div key={`${bay.id}-${k}`} className="absolute" style={{ left: r.x, top: r.y, width: r.w, height: r.h }} aria-hidden>
            <Ghost width="100%" height="100%" />
          </div>
        )),
      ])}
    </div>
  );
});
