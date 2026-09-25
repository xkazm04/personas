// The key under the map: one swatch per standing with its count, and the lens
// key at the right. Hovering a swatch lights its parcels; the three that are
// also filters (at your gate, in trouble, unclaimed) filter on click.
import type { TFeatures } from '../featuresModel';
import { PARCEL_CATS, type CadFilter, type ParcelCat } from './cadastreModel';
import { catLabel } from './ParcelTip';

const AS_FILTER: Partial<Record<ParcelCat, CadFilter>> = { gate: 'waiting', trouble: 'trouble', open: 'unclaimed' };

export interface MapKeyProps {
  counts: Record<ParcelCat, number>;
  onHover: (cat: ParcelCat | null) => void;
  onFilter: (f: CadFilter) => void;
  t: TFeatures;
  tx: (template: string, vars: Record<string, string | number>) => string;
}

export function MapKey({ counts, onHover, onFilter, t, tx }: MapKeyProps) {
  return (
    <div className="mapkey" data-role="cad-mapkey" onMouseLeave={() => onHover(null)} onBlur={() => onHover(null)}>
      {PARCEL_CATS.filter((c) => counts[c] > 0).map((c) => {
        const label = catLabel(c, t);
        const asFilter = AS_FILTER[c];
        return (
          <button
            key={c}
            type="button"
            className="k"
            data-cat={c}
            aria-label={tx(t.cadastre_key_item, { count: counts[c], label })}
            onMouseEnter={() => onHover(c)}
            onFocus={() => onHover(c)}
            onClick={asFilter ? () => onFilter(asFilter) : undefined}
          >
            <i className={`sw f-${c}`} aria-hidden="true" />
            <b>{counts[c]}</b>
            <span className="kl">{label}</span>
          </button>
        );
      })}
      <span className="sp">
        <kbd className="kbd">l</kbd>
        <span className="kt">{t.cadastre_lens}</span>
      </span>
    </div>
  );
}
