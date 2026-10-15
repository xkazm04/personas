// A commit's patch as rows for the compare panel (bp CommitDiff patchRows): a header per file, its hunks, and each line
// with its old and new line numbers. Pure. The store cuts a patch at 2000 lines (`truncated`, `lines` = the full
// count); the panel holds to the same cap whatever a source sends, and says so.

export type PatchRow = { k: 'file'; text: string } | { k: 'hunk' | 'add' | 'del' | 'ctx'; a: string; b: string; text: string };

/** The store's cut (lens-scan commits route, CommitDiff.truncated): no more patch lines than this are drawn. */
export const MAX_PATCH_LINES = 2000;

/** The patch's lines, cut at MAX_PATCH_LINES; `cut` when this cut (not the store's) removed any. */
export function capPatch(patch: string): { text: string; shown: number; cut: boolean } {
  const all = patch.split('\n');
  if (all.length <= MAX_PATCH_LINES) return { text: patch, shown: all.length, cut: false };
  return { text: all.slice(0, MAX_PATCH_LINES).join('\n'), shown: MAX_PATCH_LINES, cut: true };
}

export function patchRows(patch: string): PatchRow[] {
  const out: PatchRow[] = [];
  let ln = 0, rn = 0;
  for (const l of patch.split('\n')) {
    if (l.startsWith('diff --git')) { out.push({ k: 'file', text: l.replace(/^diff --git a\/(\S+).*/, '$1') }); continue; }
    if (/^(index |--- |\+\+\+ |new file|deleted file|similarity|rename |old mode|new mode|\\ No newline)/.test(l)) continue;
    if (l.startsWith('@@')) {
      const m = /@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(l);
      ln = m ? Number(m[1]) : 0; rn = m ? Number(m[2]) : 0;
      out.push({ k: 'hunk', a: '', b: '', text: l });
    } else if (l.startsWith('+')) out.push({ k: 'add', a: '', b: String(rn++), text: l });
    else if (l.startsWith('-')) out.push({ k: 'del', a: String(ln++), b: '', text: l });
    else if (l || out.length) out.push({ k: 'ctx', a: String(ln++), b: String(rn++), text: l });
  }
  for (let last = out[out.length - 1]; last && last.k === 'ctx' && !last.text; last = out[out.length - 1]) out.pop();
  return out;
}

/** The message split at its trailers (`Key: value` lines closing it, e.g. `Lens-Scan: p-1aab7a`). */
export function splitTrailers(message: string): { body: string; trailers: string } {
  const lines = message.replace(/\s+$/, '').split('\n');
  let t = lines.length;
  while (t > 0 && /^[A-Za-z][\w-]*: \S/.test(lines[t - 1] ?? '')) t--;
  if (t === lines.length || t === 0) return { body: message.trim(), trailers: '' };
  return { body: lines.slice(0, t).join('\n').trim(), trailers: lines.slice(t).join('\n') };
}
