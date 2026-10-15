// A `shots` row's image, through the seam: `actions.shotUrl(path)` answers a displayable URL (an object URL over the
// bytes for a live store, a data URL for the fixture). The URL is revoked when the frame that asked for it unmounts
// or asks for another path (source.ts: the caller revokes it). While it loads the frame shows its ghost.
import { useEffect, useState } from 'react';
import { useSheet } from '../../controller/SheetContext';

export type ShotState = { path: string; url: string } | { path: string; error: string } | null;

const revoke = (url: string) => { if (url.startsWith('blob:')) URL.revokeObjectURL(url); };

export function useShotUrl(path: string | undefined): ShotState {
  const { actions } = useSheet();
  const [got, setGot] = useState<ShotState>(null);
  useEffect(() => {
    if (!path) return;
    let live = true, url: string | null = null;
    actions.shotUrl(path).then(
      (u) => { if (live) { url = u; setGot({ path, url: u }); } else revoke(u); },
      (e: unknown) => { if (live) setGot({ path, error: e instanceof Error ? e.message : String(e) }); },
    );
    return () => { live = false; if (url) revoke(url); };
  }, [actions, path]);
  return got && got.path === path ? got : null;
}
