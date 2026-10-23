// The Screens strip (bp sheet/Screens.tsx ScreensStrip): the scan's captures of this feature, one thumbnail per size
// and theme (its newest run's take), with a badge when the harness report records console errors. A thumbnail opens
// the viewer under the strip (ShotViewer). A feature the harness could not render says why, from the scan's
// "unscreenable: <why>" note (bp page/LensTab.tsx Unscreenable). Images come through the seam (actions.shotUrl).
import { useMemo, useState } from 'react';
import type { Run, ScanSnapshot, Shot } from '@/lib/lensScan/wire';
import { useSheet } from '../../controller/SheetContext';
import { ShotImg } from '../compare/ShotFrame';
import { Press } from '../Press';
import { ShotViewer, shotErrors, type Take } from './ShotViewer';

const UNSCREENABLE = /^unscreenable:\s*/i;

/** Every take of the feature by size and theme, newest run first. */
function takesOf(scan: ScanSnapshot, fid: string, anySize: string, anyTheme: string): { by: Map<string, Take[]>; keys: string[]; runs: number } {
  const runs = new Map<string, Run>(scan.runs.map((r) => [r.id, r]));
  const shots = scan.shots.filter((x) => x.feature === fid);
  const when = (x: Shot) => runs.get(x.run_id)?.started_at ?? x.captured_at;
  shots.sort((a, b) => (when(a) < when(b) ? 1 : when(a) > when(b) ? -1 : 0));
  const by = new Map<string, Take[]>();
  for (const x of shots) {
    const k = (x.size ?? anySize) + ' · ' + (x.theme ?? anyTheme);
    let a = by.get(k); if (!a) by.set(k, (a = []));
    // one take per run; a pack's before and after of the same run are two takes of it
    const id = x.run_id + (x.phase ? ':' + x.phase : '');
    if (!a.some((t) => t.id === id)) a.push({ id, run: runs.get(x.run_id) ?? null, shot: x });
  }
  return { by, keys: [...by.keys()].sort(), runs: new Set(shots.map((x) => x.run_id)).size };
}

export function Unscreenable({ fid, lens }: { fid: string; lens: string }) {
  const s = useSheet(), { B, tx } = s.text, scan = s.data.scan;
  const why = useMemo(() => {
    if (scan.shots.some((x) => x.feature === fid)) return null;
    let best: { at: string; text: string } | null = null;
    for (const a of scan.activity) {
      if (a.kind !== 'note' || a.feature !== fid || (a.lens && a.lens !== lens) || !UNSCREENABLE.test(a.text)) continue;
      if (!best || a.at > best.at) best = { at: a.at, text: a.text.replace(UNSCREENABLE, '').trim() };
    }
    return best;
  }, [scan, fid, lens]);
  if (!why) return null;
  return <p className="pg-unscr">{tx(B.pg_unscreenable, { why: why.text || B.pg_unscreenable_none })}</p>;
}

export function ScreensStrip({ fid, name }: { fid: string; name: string }) {
  const s = useSheet(), { B, tx } = s.text;
  const [open, setOpen] = useState<string | null>(null);
  const g = useMemo(() => takesOf(s.data.scan, fid, B.pg_any_size, B.pg_any_theme), [s.data.scan, fid, B.pg_any_size, B.pg_any_theme]);
  if (!g.keys.length) return null;
  return (
    <div className="scr">
      <h4>{tx(B.pg_screens, { count: g.keys.length, runs: g.runs })}</h4>
      <div className="thumbs">
        {g.keys.map((k) => {
          const t = g.by.get(k)![0]!, n = shotErrors(t.shot);
          return (
            <Press key={k} tone="thumb" aria-expanded={open === k} onClick={() => setOpen(open === k ? null : k)} aria-label={tx(B.pg_shot_open, { key: k })}>
              <span className="bp-scr"><ShotImg shot={t.shot} alt="" /></span>
              <span>{k}</span>
              {n ? <em>{n}</em> : null}
            </Press>
          );
        })}
      </div>
      {open && g.by.has(open) ? <ShotViewer key={open} k={open} takes={g.by.get(open)!} name={name} close={() => setOpen(null)} /> : null}
    </div>
  );
}
