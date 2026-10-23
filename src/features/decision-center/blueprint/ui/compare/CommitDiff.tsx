import { useEffect, useMemo, useState } from 'react';
import type { CommitDiff as Diff } from '@/lib/lensScan/wire';
import { useSheet } from '../../controller/SheetContext';
import { fmtNum } from '../format';
import { capPatch, patchRows, splitTrailers } from './patch';
import { extractMessage } from '@/lib/silentCatch';

type Got = { sha: string; d: Diff } | { sha: string; error: string };
/** The patch's rows are drawn in chunks the browser skips laying out off screen (content-visibility). */
const CHUNK = 100;

/** The patch rows; mounted only while the patch is open. */
function Patch({ d }: { d: Diff }) {
  const { B, tx, language } = useSheet().text;
  const cap = useMemo(() => capPatch(d.patch), [d.patch]);
  const chunks = useMemo(() => { const rows = patchRows(cap.text), c: (typeof rows)[] = []; for (let i = 0; i < rows.length; i += CHUNK) c.push(rows.slice(i, i + CHUNK)); return c; }, [cap.text]);
  return (
    <div className="tr-diff" data-testid="blueprint-patch">
      {chunks.map((c, i) => (
        <div key={i} className="tr-dchunk">
          {c.map((r, j) => r.k === 'file' ? <div key={j} className="dfh">{r.text}</div> : <div key={j} className={'dl ' + r.k}><i>{r.a}</i><i>{r.b}</i><span>{r.text}</span></div>)}
        </div>
      ))}
      {d.truncated || cap.cut ? <div className="dl cut" data-testid="blueprint-patch-cut"><i /><i /><span>{tx(B.cmp_patch_truncated, { shown: fmtNum(language, cap.shown), lines: fmtNum(language, d.lines) })}</span></div> : null}
    </div>
  );
}

function Files({ d }: { d: Diff }) {
  return (
    <div className="tr-files">
      {d.files.map((f) => {
        const t = Math.max(1, f.add + f.del);
        return [
          <span key={f.path + ':p'} className="fp">{'‎' + f.path}</span>,
          <span key={f.path + ':n'} className="fn">+{f.add} −{f.del}</span>,
          <span key={f.path + ':b'} className="fb" aria-hidden="true"><b style={{ width: `${(f.add / t) * 100}%` }} /><s style={{ width: `${(f.del / t) * 100}%` }} /></span>,
        ];
      })}
    </div>
  );
}

/**
 * The item's commit (bp CommitDiff): asked of the seam (`actions.commitDiff(sha)`) when the panel shows the item. The
 * files with their add / delete bars at once, the message with its trailers set apart behind a disclosure, and the
 * patch behind another (open at once when the panel is wide), its lines mounted only while open, cut where the store
 * cut it and said so.
 */
export function CommitDiff({ sha, initiallyOpen = false }: { sha: string; initiallyOpen?: boolean }) {
  const s = useSheet();
  const { B, tx } = s.text;
  const [got, setGot] = useState<Got | null>(null);
  const [open, setOpen] = useState(initiallyOpen);
  useEffect(() => {
    let live = true;
    s.actions.commitDiff(sha).then((d) => { if (live) setGot({ sha, d }); }, (e: unknown) => { if (live) setGot({ sha, error: extractMessage(e) }); });
    return () => { live = false; };
  }, [s.actions, sha]);
  const cur = got && got.sha === sha ? got : null, d = cur && 'd' in cur ? cur.d : null;
  const add = d ? d.files.reduce((n, f) => n + f.add, 0) : 0, del = d ? d.files.reduce((n, f) => n + f.del, 0) : 0;
  const msg = d ? splitTrailers(d.message) : null;
  return (
    <section className="tr-sec" data-testid="blueprint-commit">
      <h4>{B.cmp_commit_head} <code className="c">{sha.slice(0, 7)}</code>{d ? <span className="n">· {tx(B.cmp_commit_files, { files: d.files.length, add, del })}</span> : null}</h4>
      {!cur ? <p className="tr-dim">{B.lg_cmp_loading_commit}</p> : 'error' in cur ? <p className="tr-dim" role="alert">{tx(B.cmp_commit_error, { message: cur.error })}</p> : (
        <>
          <Files d={cur.d} />
          <details className="tr-det"><summary>{B.cmp_commit_message}</summary><pre className="tr-msg">{msg?.body}{msg?.trailers ? <>{'\n\n'}<span className="trl">{msg.trailers}</span></> : null}</pre></details>
          <details className="tr-det" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
            <summary>{tx(B.cmp_patch, { lines: cur.d.lines })}</summary>
            {open ? <Patch d={cur.d} /> : null}
          </details>
        </>
      )}
    </section>
  );
}
