// The altitude timeline: five rungs on a vertical track and a needle that
// rides the engine's eased altitude. The needle is moved from the engine's
// own frame callback, never from React state, so it lands WITH the camera
// (the flight's curve drives both) and costs nothing when the field rests.
import { useCallback, useLayoutEffect, useRef } from 'react';

import { interpolate as tx } from '@/i18n/useTranslation';

import { useCouncilStore } from '../../councilStore';
import type { EnginePath, GalaxyEngine } from '../engine/GalaxyEngine';
import { useFusedStrings } from './fusedStrings';
import { currentFigures, rungsFor } from './timelineModel';
import { TimelineRung } from './TimelineRung';
import type { FusedData } from './useFused';

interface Props {
  engine: GalaxyEngine | null;
  path: EnginePath;
  data: FusedData;
}

export function AltitudeTimeline({ engine, path, data }: Props) {
  const s = useFusedStrings();
  const layout = useCouncilStore((st) => st.layout);
  const focus = useCouncilStore((st) => st.focus);
  const counts = useCouncilStore((st) => st.counts);
  const clearCouncilFocus = useCouncilStore((st) => st.clearCouncilFocus);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const needleRef = useRef<HTMLDivElement | null>(null);
  const rungY = useRef<number[]>([0, 0, 0, 0, 0]);

  const placeNeedle = useCallback(() => {
    const needle = needleRef.current;
    if (!needle || !engine) return;
    const alt = Math.max(0, Math.min(4, engine.getAltitude()));
    const i = Math.min(3, Math.floor(alt));
    const y = rungY.current;
    const at = (y[i] ?? 0) + ((y[i + 1] ?? 0) - (y[i] ?? 0)) * (alt - i);
    needle.style.transform = `translateY(${at.toFixed(1)}px)`;
  }, [engine]);

  // The rung centres move whenever the rungs re-render (a name wraps, the
  // current card grows), so they are measured after every layout.
  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const top = track.getBoundingClientRect().top;
    track.querySelectorAll<HTMLElement>('.rung').forEach((li) => {
      const tag = li.querySelector('.tag')?.getBoundingClientRect();
      if (tag) rungY.current[Number(li.dataset.rung)] = tag.top - top + tag.height / 2;
    });
    placeNeedle();
  });

  useLayoutEffect(() => (engine ? engine.onFrame(placeNeedle) : undefined), [engine, placeNeedle]);

  if (!layout) return null;
  const council = focus.kind === 'council' ? focus : null;
  const missing = council ? council.registrySubjects.filter((slug) => !layout.bySlug.get(slug)).length : 0;
  const rungs = rungsFor(s, layout, path, council?.title ?? null);
  const climb = (i: number) => {
    if (i === 0 && council) clearCouncilFocus();
    engine?.climbTo(i);
  };

  return (
    <div className="fz-track" ref={trackRef}>
      <div className="line" />
      <div className="fz-needle" ref={needleRef} />
      <ol className="fz-rungs">
        {rungs.map((r) => (
          <TimelineRung
            key={r.index}
            index={r.index}
            state={r.state}
            tag={r.tag}
            name={r.name}
            technique={r.index === 4}
            onClimb={() => climb(r.index)}
            climbLabel={tx(s.f.climb_to, { name: r.index === 0 ? s.f.the_sky : r.name })}
            sounding={r.sounding}
            figures={r.state === 'current' ? currentFigures(s, path, data, counts, council ? { missing } : null) : undefined}
            neighbourKeys={
              r.state === 'current' && r.index > 0 ? (
                <span className="nb" aria-label={s.f.neighbour_keys}>
                  <kbd>[</kbd>
                  <kbd>]</kbd>
                </span>
              ) : null
            }
          />
        ))}
      </ol>
    </div>
  );
}

export default AltitudeTimeline;
