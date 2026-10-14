import { useEffect, useRef } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react';
import { Crumbs, KitButton, KitHost } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import { stationName } from '../../../labels';
import type { ProcessViewProps } from '../../types';
import { sheetWidth } from '../camera';
import type { Scene } from '../useScene';
import type { Nav } from '../WatershedView';
import { StationSheet } from './StationSheet';
import { VoyageSheet } from './VoyageSheet';
import './sheet.css';

export interface SheetProps extends ProcessViewProps {
  scene: Scene;
  nav: Nav;
  setNav: (n: Nav) => void;
  goUp: () => boolean;
}

/**
 * The survey sheet: the Watershed's second and third depths. A settlement's sheet carries its
 * figures, the work done there, the wait before it and the sessions that failed or stumbled
 * there; a session's voyage log carries its course and step sequence. It stays mounted once
 * opened, so it slides in and out (a transform) instead of popping.
 */
export default function SurveySheet(props: SheetProps) {
  const { scene, nav, setNav, goUp, model } = props;
  const { t, tx } = useTranslation();
  const p = t.companions.process;
  const w = p.watershed;
  const backRef = useRef<HTMLDivElement>(null);
  const open = nav.station != null || nav.session != null;
  const level = nav.session ? 2 : 1;
  const q = nav.station ?? 0;
  const s = model.stations[q];
  const name = s ? stationName(p, s.keys) : '';

  useEffect(() => {
    if (!open) return;
    const h = window.setTimeout(() => backRef.current?.querySelector('button')?.focus({ preventScroll: true }), 30);
    return () => window.clearTimeout(h);
  }, [open, nav.station, nav.session]);

  const levels = [w.level_map, w.level_settlement, w.level_voyage];
  const crumbs = [
    { label: p.view_watershed, onPress: () => setNav({ station: null, session: null }) },
    nav.session ? { label: name, onPress: () => setNav({ station: nav.station, session: null }) } : { label: name },
    ...(nav.session ? [{ label: nav.session }] : []),
  ];

  return (
    <aside
      className={open ? 'ws-sheet is-open' : 'ws-sheet'}
      style={{ width: sheetWidth(scene.g.W) }}
      aria-label={w.sheet_aria}
      aria-hidden={!open}
      inert={!open}
      data-testid="watershed-sheet"
    >
      <KitHost>
        <div className="ws-sheet-head">
          <div className="ws-head-row">
            <div ref={backRef}>
              <KitButton icon={<ArrowLeft />} hint="Esc" onClick={goUp} testId="watershed-sheet-back">
                {level === 2 ? tx(w.back_to, { name }) : w.back_map}
              </KitButton>
            </div>
            <div className="ws-depth typo-caption" role="img" aria-label={tx(w.level_aria, { level: level + 1, name: levels[level]! })}>
              {levels.map((_, i) => <i key={i} className={i <= level ? 'is-on' : ''} />)}
              <span>{levels[level]}</span>
            </div>
            <div className="ws-head-nav">
              {level === 1 && (
                <>
                  <KitButton icon={<ChevronLeft />} label={w.prev} disabled={q === 0} onClick={() => setNav({ station: q - 1, session: null })}>{''}</KitButton>
                  <KitButton icon={<ChevronRight />} label={w.next} disabled={q >= model.stations.length - 1} onClick={() => setNav({ station: q + 1, session: null })}>{''}</KitButton>
                </>
              )}
            </div>
          </div>
          <Crumbs items={crumbs} label={w.crumbs_aria} />
        </div>
        {open && s && (
          <div className="ws-sheet-body is-entering" key={`${q}|${nav.session ?? ''}`}>
            {nav.session ? <VoyageSheet {...props} id={nav.session} /> : <StationSheet {...props} q={q} />}
          </div>
        )}
      </KitHost>
    </aside>
  );
}
