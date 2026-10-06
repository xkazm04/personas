/** Lettered - text lettered in by hand, a few characters at a time (Studio's
 *  drafting title block, copied, not imported: Studio keeps it private). The
 *  untyped rest keeps its room invisibly, so nothing reflows while it types.
 *  Read whole by assistive tech; the lettering is for the eye only. */
import { useEffect, useState } from "react";
import { useMotion } from "@/hooks/utility/interaction/useMotion";

export function Lettered({ text, perTick = 0 }: { text: string; perTick?: number }) {
  const { shouldAnimate } = useMotion();
  const [state, setState] = useState({ text, n: 0 });
  if (state.text !== text) setState({ text, n: 0 });
  const n = state.text === text ? state.n : 0;

  useEffect(() => {
    if (!shouldAnimate || n >= text.length) return;
    const step = perTick || Math.max(1, Math.round(text.length / 60));
    const h = window.setTimeout(() => setState((s) => (s.text === text ? { text, n: Math.min(text.length, s.n + step) } : s)), 30);
    return () => window.clearTimeout(h);
  }, [text, n, perTick, shouldAnimate]);

  if (!shouldAnimate) return <>{text}</>;
  return (
    <>
      <span className="sr-only">{text}</span>
      <span aria-hidden>
        {text.slice(0, n)}
        <span className="invisible">{text.slice(n)}</span>
      </span>
    </>
  );
}
