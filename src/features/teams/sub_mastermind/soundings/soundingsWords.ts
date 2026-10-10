// Soundings — the words. Band names and what each band MEANS, the four lane
// labels, and the reason phrases the waterline reads out.
//
// Extracted from SoundingsView 2026-10-06: the view mixed sentence assembly in
// among the geometry, so a copy change meant reading a render.
import { useTranslation } from '@/i18n/useTranslation';

import type { DimCategory } from '../lib/dimRegistry';
import type { Reason } from './soundingsModel';

export type SoundingsWords = ReturnType<typeof useSoundingsWords>;

export function useSoundingsWords() {
  const { t, tx } = useTranslation();
  const m = t.mastermind;

  const bandName = [m.soundings_band_surface, m.soundings_band_shallows, m.soundings_band_midwater, m.soundings_band_deep];
  const bandMean = [m.soundings_band_surface_mean, m.soundings_band_shallows_mean, m.soundings_band_midwater_mean, m.soundings_band_deep_mean];

  const laneLabel = (lane: DimCategory): string =>
    ({ runtime: m.dim_cat_runtime, delivery: m.dim_cat_delivery, agentic: m.dim_cat_agentic, product: m.dim_cat_product })[lane];

  const reasonText = (r: Reason): string => {
    switch (r.kind) {
      case 'alerts': return tx(r.count === 1 ? m.soundings_reason_alerts_one : m.soundings_reason_alerts_other, { count: r.count ?? 0 });
      case 'risks': return tx(r.count === 1 ? m.soundings_reason_risks_one : m.soundings_reason_risks_other, { count: r.count ?? 0 });
      case 'stalled': return m.soundings_reason_stalled;
      case 'critical': return m.soundings_reason_critical;
      case 'late': return tx(m.soundings_reason_late, { name: r.name ?? '' });
      case 'waiting': return tx(m.soundings_reason_waiting, { name: r.name ?? '' });
      case 'unbound': return m.soundings_reason_unbound;
    }
  };

  return { m, t, tx, bandName, bandMean, laneLabel, reasonText };
}
