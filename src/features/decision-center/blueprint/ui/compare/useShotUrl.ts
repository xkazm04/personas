// A `shots` row's image, through the seam: `actions.shotUrl(path)` answers a displayable URL (an object URL over the
// bytes for a live store, a data URL for the fixture). The URL is revoked when the frame that asked for it unmounts
// or asks for another path (source.ts: the caller revokes it). While it loads the frame shows its ghost.
// useShotUrls asks for several at once (the compare panel's screens, whose change maps need both sides of each pair).
import { useEffect, useState } from 'react';
import { useSheet } from '../../controller/SheetContext';

export type ShotState = { path: string; url: string } | { path: string; error: string } | null;

const revoke = (url: string) => { if (url.startsWith('blob:')) URL.revokeObjectURL(url); };
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function useShotUrl(path: string | undefined): ShotState {
  const { actions } = useSheet();
  const [got, setGot] = useState<ShotState>(null);
  useEffect(() => {
    if (!path) return;
    let live = true, url: string | null = null;
    actions.shotUrl(path).then(
      (u) => { if (live) { url = u; setGot({ path, url: u }); } else revoke(u); },
      (e: unknown) => { if (live) setGot({ path, error: errText(e) }); },
    );
    return () => { live = false; if (url) revoke(url); };
  }, [actions, path]);
  return got && got.path === path ? got : null;
}

/** Every path's state, asked together; each URL is revoked when the set changes or the caller unmounts. */
export function useShotUrls(paths: readonly string[]): ReadonlyMap<string, Exclude<ShotState, null>> {
  const { actions } = useSheet();
  const key = paths.join('\u0000');
  const [got, setGot] = useState<{ key: string; m: Map<string, Exclude<ShotState, null>> }>({ key: '', m: new Map() });
  useEffect(() => {
    const list = key ? key.split('\u0000') : [];
    let live = true;
    const urls: string[] = [];
    for (const path of list) {
      actions.shotUrl(path).then(
        (u) => { if (!live) { revoke(u); return; } urls.push(u); setGot((g) => ({ key, m: new Map(g.key === key ? g.m : []).set(path, { path, url: u }) })); },
        (e: unknown) => { if (live) setGot((g) => ({ key, m: new Map(g.key === key ? g.m : []).set(path, { path, error: errText(e) }) })); },
      );
    }
    return () => { live = false; for (const u of urls) revoke(u); };
  }, [actions, key]);
  return got.key === key ? got.m : EMPTY;
}

const EMPTY: ReadonlyMap<string, Exclude<ShotState, null>> = new Map<string, Exclude<ShotState, null>>();
