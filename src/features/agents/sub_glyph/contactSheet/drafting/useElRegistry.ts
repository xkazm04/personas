/** useElRegistry - the drawn parts the pen and the camera aim at, by id
 *  ("region:task", "brief", "notes", "figure"). Ref callbacks are stable per
 *  id, and the map only changes when an element actually mounts or unmounts. */
import { useCallback, useState } from "react";

export function useElRegistry() {
  const [els, setEls] = useState<Record<string, HTMLElement | null>>({});
  const [cache] = useState(() => new Map<string, (el: HTMLElement | null) => void>());
  const refFor = useCallback((id: string) => {
    let fn = cache.get(id);
    if (!fn) {
      fn = (el: HTMLElement | null) => setEls((m) => (m[id] === el ? m : { ...m, [id]: el }));
      cache.set(id, fn);
    }
    return fn;
  }, [cache]);
  return { els, refFor };
}

/** The drawing's epoch: it carries over from compose into the build it
 *  launches (the same sheet goes on being drawn), and starts over when that
 *  build gives way to another one or to a fresh compose. */
export function useDrawingEpoch(sessionId: string | null): number {
  const [epoch, setEpoch] = useState({ session: sessionId, n: 0 });
  if (epoch.session !== sessionId) {
    setEpoch({ session: sessionId, n: epoch.session === null ? epoch.n : epoch.n + 1 });
  }
  return epoch.n;
}
