/** Lettered - text lettered in by hand, a few characters at a time, behind a
 *  travelling caret (Studio's brief, contest A/3). The unlettered rest keeps
 *  its room, invisible, so the line never reflows while it is written. Read
 *  whole by assistive tech; reduced motion shows it at once. */
import { useEffect, useState } from "react";
import { useMotion } from "@/hooks/utility/interaction/useMotion";

export function Lettered({ text, startDelay = 0 }: { text: string; startDelay?: number }) {
  const { shouldAnimate } = useMotion();
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!shouldAnimate) return;
    setN(0);
    const step = Math.max(1, Math.round(text.length / 40));
    let timer = 0;
    const start = window.setTimeout(() => {
      timer = window.setInterval(() => {
        setN((c) => {
          const next = Math.min(text.length, c + step);
          if (next >= text.length) window.clearInterval(timer);
          return next;
        });
      }, 42);
    }, startDelay);
    return () => { window.clearTimeout(start); window.clearInterval(timer); };
  }, [text, startDelay, shouldAnimate]);

  if (!shouldAnimate) return <>{text}</>;
  const writing = n < text.length;
  return (
    <>
      <span className="sr-only">{text}</span>
      <span aria-hidden className="whitespace-pre-wrap">
        {text.slice(0, n)}
        {writing && <i className="relative -mr-[2px] inline-block w-[2px] align-baseline" style={{ height: "0.9em", background: "var(--ink)", top: "0.1em" }} />}
        <span className="invisible">{text.slice(n)}</span>
      </span>
    </>
  );
}
