import type { ReactNode, Ref } from 'react';
import type { Shot } from '@/lib/lensScan/wire';
import { useSheet } from '../../controller/SheetContext';
import { useShotUrl, type ShotState } from './useShotUrl';

/** One captured screen asking its own URL: a ghost while it loads, the image, or the reason it did not load. The
 *  feature page's screens use it (ui/page); the compare panel resolves its pairs together and draws UrlImg. */
export function ShotImg({ shot, alt, className }: { shot: Shot | undefined; alt: string; className?: string }) {
  const got = useShotUrl(shot?.path);
  return shot ? <UrlImg got={got} alt={alt} className={className} /> : <NoCapture />;
}

/** A resolved screen: the ghost while its URL is on its way, the image, or why it did not load. */
export function UrlImg({ got, alt, className }: { got: ShotState | undefined; alt: string; className?: string }) {
  const { B, tx } = useSheet().text;
  if (!got) return <span className="bp-scr-ghost tr-scr-ghost" aria-hidden="true" data-testid="blueprint-shot-ghost" />;
  if ('error' in got) return <span className="bp-scr-none tr-scr-none" role="note">{tx(B.cmp_shot_failed, { message: got.error })}</span>;
  return <img src={got.url} alt={alt} className={className} decoding="async" draggable={false} data-testid="blueprint-shot" />;
}

/** A frame with no capture on that side. */
export function NoCapture() {
  const { B } = useSheet().text;
  return <span className="bp-scr-none tr-scr-none">{B.cmp_shot_missing}</span>;
}

/**
 * One screen of the compare panel (bp ShotFigure): a captioned 16:9 frame, the caption's left naming it and its right
 * carrying a fact or a control, with whatever the mode draws inside (one image, the slider's two, blink's two or the
 * change map). Every mode renders through this, so the caption and the frame look the same in all four.
 */
export function ShotFigure({ cap, aside, frame, frameRef, children }: { cap: ReactNode; aside?: ReactNode; frame?: string; frameRef?: Ref<HTMLDivElement>; children: ReactNode }) {
  return (
    <figure className="tr-fig">
      <figcaption><span>{cap}</span>{aside !== undefined ? <span>{aside}</span> : null}</figcaption>
      <div ref={frameRef} className={'tr-scr' + (frame ? ' ' + frame : '')}>{children}</div>
    </figure>
  );
}
