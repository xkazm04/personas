/** The lane peek's extra footer hint: the keys that jump between lanes. */
import { useTranslation } from '@/i18n/useTranslation';

import { Keycap } from '../../deck/parts';

export function LaneFooter() {
  const { t } = useTranslation();
  return (
    <>
      <Keycap className="ml-2">1</Keycap>–<Keycap>4</Keycap>
      <Keycap>O</Keycap> {t.monitor.ml_lane_key_lanes}
    </>
  );
}
