import { useEffect, useRef, useState } from 'react';

const FADE_MS = 300;

interface TitleCrossfadeProps {
  text: string;
}

/**
 * Renders the radio footer's title text with a 300ms opacity crossfade
 * when it changes (new YouTube track, new SomaFM metadata update,
 * station switch). The outgoing string stays absolutely positioned in
 * the same slot, fading out, while the incoming string fades in over
 * it; after the animation window the outgoing layer unmounts. The
 * parent element must be `position: relative` so the absolute overlay
 * anchors correctly. The `truncate` class on each layer keeps the
 * fade compatible with the existing max-w / overflow rules around the
 * title segment — long titles still ellipsize.
 */
export default function TitleCrossfade({ text }: TitleCrossfadeProps) {
  const [shown, setShown] = useState(text);
  const [outgoing, setOutgoing] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (text === shown) return;
    setOutgoing(shown);
    setShown(text);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      setOutgoing(null);
      timerRef.current = null;
    }, FADE_MS + 20);
  }, [text, shown]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  return (
    <>
      <span
        key={shown}
        className="block truncate"
        style={{ animation: `fade-in ${FADE_MS}ms ease-out` }}
      >
        {shown}
      </span>
      {outgoing !== null && (
        <span
          key={`out-${outgoing}`}
          aria-hidden
          className="absolute inset-0 block truncate pointer-events-none"
          style={{ animation: `fade-out ${FADE_MS}ms ease-out forwards` }}
        >
          {outgoing}
        </span>
      )}
    </>
  );
}
