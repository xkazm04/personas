/**
 * LAYERED PROTOTYPE - BANDS. STUB (WP0): the final signature; a builder fills it.
 */
import { FilmstripCanvas } from '../../variants/FilmstripCanvas';
import { useLayerNav } from '../useLayers';

export function BandsLayers({ leftWidth }: { leftWidth: number }) {
  const nav = useLayerNav();
  return <FilmstripCanvas leftWidth={leftWidth} onOpenProject={nav.openProject} />;
}
