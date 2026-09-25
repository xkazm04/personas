/** LogLayer - the build's live CLI output, one layer down from the slate's log
 *  line. The expanded half of the old GlyphActivityStrip: the latest lines,
 *  monospaced, following the tail while the build writes unless the reader
 *  has scrolled up to read something. */
import { useLayoutEffect, useRef } from "react";
import { COPY } from "./copy";

const KEEP = 200;
/** Within this many px of the bottom counts as following the tail. */
const FOLLOW_PX = 40;

export function LogLayer({ lines }: { lines: string[] }) {
  const box = useRef<HTMLDivElement | null>(null);
  const follow = useRef(true);
  const tail = lines.slice(-KEEP);

  useLayoutEffect(() => {
    const el = box.current;
    if (el && follow.current) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-3 max-w-[980px] w-full mx-auto">
      <p className="typo-body-lg text-foreground">{COPY.buildLogHint}</p>
      <div
        ref={box}
        onScroll={(e) => {
          const el = e.currentTarget;
          follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < FOLLOW_PX;
        }}
        className="flex-1 min-h-[160px] overflow-y-auto rounded-card border border-card-border bg-card-bg p-3.5"
        role="log"
        data-testid="sheet-cinema-build-log"
      >
        {tail.length === 0 ? (
          <span className="typo-body text-foreground">{COPY.buildLogEmpty}</span>
        ) : (
          tail.map((line, i) => (
            <div key={`${lines.length - tail.length + i}`} className="font-mono typo-caption text-foreground leading-snug whitespace-pre-wrap break-words">
              {line}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
