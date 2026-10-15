import { useRef, type ReactNode } from 'react';
import type { Shot } from '@/lib/lensScan/wire';
import { useSheet } from '../../controller/SheetContext';
import { useShotUrl } from './useShotUrl';

/** One captured screen inside a frame: a ghost while its URL loads, the image, or the reason it did not load. */
export function ShotImg({ shot, alt, className }: { shot: Shot | undefined; alt: string; className?: string }) {
  const { B, tx } = useSheet().text;
  const got = useShotUrl(shot?.path);
  if (!shot) return <span className="bp-scr-none typo-body">{B.cmp_shot_missing}</span>;
  if (!got) return <span className="bp-scr-ghost" aria-hidden="true" data-testid="blueprint-shot-ghost" />;
  if ('error' in got) return <span className="bp-scr-none typo-body" role="note">{tx(B.cmp_shot_failed, { message: got.error })}</span>;
  return <img src={got.url} alt={alt} className={className} decoding="async" draggable={false} data-testid="blueprint-shot" />;
}

/** A captioned 16:9 frame (bp ShotFigure): the caption names the screen, the aside carries one fact. */
export function ShotFrame({ cap, aside, children, frameRef }: { cap: string; aside?: ReactNode; children: ReactNode; frameRef?: React.Ref<HTMLDivElement> }) {
  return (
    <figure className="bp-fig">
      <figcaption className="typo-code"><span>{cap}</span>{aside ? <span className="bp-ink">{aside}</span> : null}</figcaption>
      <div ref={frameRef} className="bp-scr">{children}</div>
    </figure>
  );
}

/**
 * The slider (bp Screens Slider): the after clipped over the before at --cut; the range input sets the variable on the
 * frame, so dragging never re-renders React. A native range input is the control: arrows move it from the keyboard.
 */
export function SliderFrame({ before, after, theme }: { before: Shot; after: Shot; theme: string }) {
  const { B, tx } = useSheet().text;
  const frame = useRef<HTMLDivElement>(null);
  return (
    <ShotFrame cap={tx(B.cmp_slider_cap, { theme })} frameRef={frame}>
      <ShotImg shot={before} alt={tx(B.cmp_shot_before, { theme })} />
      <ShotImg shot={after} alt={tx(B.cmp_shot_after, { theme })} className="bp-top" />
      <input type="range" min="0" max="100" defaultValue="50" aria-label={B.cmp_slider_label} className="bp-slide"
        onInput={(e) => frame.current?.style.setProperty('--cut', e.currentTarget.value + '%')} />
    </ShotFrame>
  );
}
