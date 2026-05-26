export type DiffLineKind = 'common' | 'app' | 'vault';

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
}

/**
 * Line-level diff between the app-side and vault-side versions of a
 * conflicted note. Returns an interleaved sequence: shared lines as
 * `common`, lines unique to the app version as `app`, lines unique to the
 * vault version as `vault`.
 *
 * Uses a real longest-common-subsequence (not a set difference) so line
 * order and duplicate lines are preserved — important for prose, where the
 * same blank line or heading legitimately recurs. The cost is O(n·m) in the
 * line counts, so callers should cap very large inputs before diffing.
 */
export function diffNoteLines(appContent: string, vaultContent: string): DiffLine[] {
  const a = appContent.split('\n');
  const b = vaultContent.split('\n');
  const n = a.length;
  const m = b.length;

  // lcs[i][j] = length of the LCS of a[i..] and b[j..]. Indices are kept
  // in-bounds by construction, so the `!` assertions are safe under
  // noUncheckedIndexedAccess.
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    const row = lcs[i]!;
    const nextRow = lcs[i + 1]!;
    for (let j = m - 1; j >= 0; j--) {
      row[j] = a[i] === b[j] ? nextRow[j + 1]! + 1 : Math.max(nextRow[j]!, row[j + 1]!);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: 'common', text: a[i]! });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      out.push({ kind: 'app', text: a[i]! });
      i++;
    } else {
      out.push({ kind: 'vault', text: b[j]! });
      j++;
    }
  }
  while (i < n) out.push({ kind: 'app', text: a[i++]! });
  while (j < m) out.push({ kind: 'vault', text: b[j++]! });
  return out;
}
