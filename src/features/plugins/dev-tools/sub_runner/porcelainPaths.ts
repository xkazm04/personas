/**
 * Paths named by `git status --porcelain` lines (`XY path`, `R  old -> new`,
 * C-quoted when they hold spaces or non-ASCII), so a commit can stage exactly
 * the files the operator confirmed. A rename yields both sides: the old path's
 * deletion must be staged too.
 */
const BACKSLASH = '\\';
const ESCAPES: Record<string, string> = { n: '\n', t: '\t', '"': '"', [BACKSLASH]: BACKSLASH };

function unquote(raw: string): string {
  if (!(raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"'))) return raw;
  const bytes: number[] = [];
  const enc = new TextEncoder();
  const body = raw.slice(1, -1);
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (ch !== BACKSLASH) {
      bytes.push(...enc.encode(ch));
      continue;
    }
    i += 1;
    const octal = /^[0-7]{3}/.exec(body.slice(i, i + 3));
    if (octal) {
      bytes.push(parseInt(octal[0], 8));
      i += 2;
      continue;
    }
    const next = body[i] ?? '';
    bytes.push(...enc.encode(ESCAPES[next] ?? next));
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

export function porcelainPaths(lines: readonly string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    const rest = line.slice(3);
    if (!rest) continue;
    // Only renames/copies carry ` -> `; a plain path may legally contain it.
    const arrow = rest.indexOf(' -> ');
    const isMove = /^[RC]/.test(line.trimStart());
    const parts = isMove && arrow >= 0 ? [rest.slice(0, arrow), rest.slice(arrow + 4)] : [rest];
    for (const p of parts) out.push(unquote(p));
  }
  return out;
}
