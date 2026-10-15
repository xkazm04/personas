import { useEffect, useMemo, useState } from 'react';
import { DocumentGhost } from '@/features/shared/components/document/DocumentGhost';
import type { CommitDiff as Diff } from '@/lib/lensScan/wire';
import { useSheet } from '../../controller/SheetContext';
import { fmtNum } from '../format';
import { capPatch, patchRows, splitTrailers } from './patch';

type Got = { sha: string; d: Diff } | { sha: string; error: string };

/** The patch rows; mounted only while the patch is open. Monospace at the code size (the type floor's one exception). */
function Patch({ d }: { d: Diff }) {
  const { B, tx, language } = useSheet().text;
  const cap = useMemo(() => capPatch(d.patch), [d.patch]);
  const rows = useMemo(() => patchRows(cap.text), [cap.text]);
  return (
    <div className="bp-diff typo-code" data-testid="blueprint-patch">
      {rows.map((r, i) => r.k === 'file'
        ? <div key={i} className="bp-dfh">{r.text}</div>
        : <div key={i} className={`bp-dl bp-${r.k}`}><i>{r.a}</i><i>{r.b}</i><span>{r.text}</span></div>)}
      {d.truncated || cap.cut ? <div className="bp-dl bp-cut" data-testid="blueprint-patch-cut"><i /><i /><span>{tx(B.cmp_patch_truncated, { shown: fmtNum(language, cap.shown), lines: fmtNum(language, d.lines) })}</span></div> : null}
    </div>
  );
}

function Files({ d }: { d: Diff }) {
  return (
    <div className="bp-files typo-code">
      {d.files.map((f) => {
        const t = Math.max(1, f.add + f.del);
        return (
          <div key={f.path} className="bp-file">
            <span className="bp-fp">{f.path}</span>
            <span className="bp-fn">+{f.add} −{f.del}</span>
            <span className="bp-fb" aria-hidden="true"><b style={{ width: `${(f.add / t) * 100}%` }} /><s style={{ width: `${(f.del / t) * 100}%` }} /></span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * The item's commit (bp CommitDiff): asked of the seam (`actions.commitDiff(sha)`) when the compare panel shows the
 * item, a ghost under the section's heading while it comes. The files with their add / delete bars at once, the
 * message with its trailers behind a disclosure, and the patch behind another, its lines mounted only while it is open,
 * cut where the store cut it (and said so: `truncated`, `lines`).
 */
export function CommitDiff({ sha }: { sha: string }) {
  const s = useSheet();
  const { B, tx } = s.text;
  const [got, setGot] = useState<Got | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let live = true;
    s.actions.commitDiff(sha).then((d) => { if (live) setGot({ sha, d }); }, (e: unknown) => { if (live) setGot({ sha, error: e instanceof Error ? e.message : String(e) }); });
    return () => { live = false; };
  }, [s.actions, sha]);
  const cur = got && got.sha === sha ? got : null, d = cur && 'd' in cur ? cur.d : null;
  const add = d ? d.files.reduce((n, f) => n + f.add, 0) : 0, del = d ? d.files.reduce((n, f) => n + f.del, 0) : 0;
  const msg = d ? splitTrailers(d.message) : null;
  return (
    <section className="bp-cmp-sec" data-testid="blueprint-commit">
      <h4 className="typo-eyebrow bp-eyebrow">
        {B.cmp_commit_head} <code className="typo-code">{sha.slice(0, 7)}</code>
        {d ? <span className="bp-ink"> {'·'} {tx(B.cmp_commit_files, { files: d.files.length, add, del })}</span> : null}
      </h4>
      {!cur ? <DocumentGhost testId="blueprint-commit-ghost" /> : 'error' in cur ? <p className="bp-empty typo-body" role="alert">{tx(B.cmp_commit_error, { message: cur.error })}</p> : (
        <>
          <Files d={cur.d} />
          <details className="bp-det">
            <summary className="typo-body">{B.cmp_commit_message}</summary>
            <pre className="bp-msg typo-code">{msg?.body}{msg?.trailers ? <>{'\n\n'}<span className="bp-ink">{msg.trailers}</span></> : null}</pre>
          </details>
          <details className="bp-det" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
            <summary className="typo-body">{tx(B.cmp_patch, { lines: cur.d.lines })}</summary>
            {open ? <Patch d={cur.d} /> : null}
          </details>
        </>
      )}
    </section>
  );
}
