/**
 * extractRustStrings — every string literal in a Rust file, multi-line safe.
 *
 * THE RECORDED BUG THIS EMBODIES (golden-path doctrine §2, "Two independent
 * implementations of every count"):
 *
 *   Draft 1 excluded newlines from its string character class. Every multi-line
 *   SQL literal in the tree became invisible; the two implementations reported
 *   33 and 22 against a hand-verified truth of 141.
 *
 *   Draft 2 fixed the class but wrote the escape handling as `\\.`, where `.`
 *   does not match a newline. A Rust line continuation inside a string
 *   (a trailing `\` immediately before the newline) therefore terminated the
 *   match early — which split an `ORDER BY` from its `LIMIT` in the middle of a
 *   query and produced 104 and 63 against the same truth of 141.
 *
 * Both drafts were regexes. A regex cannot see a `r#"…"#` delimiter count, and
 * both of the failures above are the regex quietly answering a *different*
 * question than the one asked. So this is a scanner, not a pattern.
 *
 * Handles: normal (`"…"`), byte (`b"…"`), raw (`r"…"`), raw-hash
 * (`r#"…"#`, `r##"…"##`, …), byte-raw (`br#"…"#`). Skips line comments,
 * (nested) block comments, char literals, and — the one that bites — lifetimes
 * (`'a`), which open a quote that never closes.
 *
 * `content` is the literal's interior EXACTLY AS WRITTEN (escapes not resolved).
 * That is what a SQL / URL / pattern sweep wants to read; resolving `\n` would
 * destroy the line structure the caller is usually measuring.
 *
 * `startLine` is 1-based. `startCol` is the 1-based column of the literal's
 * FIRST character — the `r` in `r#"…"#`, not the quote.
 */

/** Character classes that may begin an identifier (so `foo_r"x"` is not a raw string). */
const isIdentChar = (c) => c !== undefined && /[A-Za-z0-9_]/.test(c);

/**
 * Walk Rust source once, emitting every lexical region.
 *
 * The single scanner both `extractRustStrings` and `maskRustLiteralsAndComments`
 * are built on, so a fix to the lexer cannot reach one caller and miss the
 * other. Regions are emitted in source order and cover the source exactly once.
 *
 * @param {string} src
 * @returns {Array<{kind:'code'|'line-comment'|'block-comment'|'string', start:number, end:number,
 *                  stringKind?:'normal'|'byte'|'raw'|'raw-hash'|'byte-raw', innerStart?:number, innerEnd?:number}>}
 */
export function scanRust(src) {
  const regions = [];
  let i = 0;
  let codeStart = 0;

  const flushCode = (upto) => {
    if (upto > codeStart) regions.push({ kind: 'code', start: codeStart, end: upto });
  };

  while (i < src.length) {
    const c = src[i];
    const c2 = src[i + 1];

    // ---- line comment
    if (c === '/' && c2 === '/') {
      flushCode(i);
      const start = i;
      while (i < src.length && src[i] !== '\n') i++;
      regions.push({ kind: 'line-comment', start, end: i });
      codeStart = i;
      continue;
    }

    // ---- block comment (Rust nests them)
    if (c === '/' && c2 === '*') {
      flushCode(i);
      const start = i;
      let depth = 0;
      while (i < src.length) {
        if (src[i] === '/' && src[i + 1] === '*') { depth++; i += 2; continue; }
        if (src[i] === '*' && src[i + 1] === '/') { depth--; i += 2; if (depth === 0) break; continue; }
        i++;
      }
      regions.push({ kind: 'block-comment', start, end: i });
      codeStart = i;
      continue;
    }

    // ---- raw / byte-raw string: r"…", r#"…"#, br##"…"##
    if ((c === 'r' || (c === 'b' && c2 === 'r')) && !isIdentChar(src[i - 1])) {
      const prefixLen = c === 'r' ? 1 : 2;
      let j = i + prefixLen;
      let hashes = 0;
      while (src[j] === '#') { hashes++; j++; }
      if (src[j] === '"') {
        flushCode(i);
        const start = i;
        const innerStart = j + 1;
        const terminator = '"' + '#'.repeat(hashes);
        const close = src.indexOf(terminator, innerStart);
        const innerEnd = close === -1 ? src.length : close;
        const end = close === -1 ? src.length : close + terminator.length;
        regions.push({
          kind: 'string',
          stringKind: c === 'r' ? (hashes ? 'raw-hash' : 'raw') : 'byte-raw',
          start, end, innerStart, innerEnd,
        });
        i = end;
        codeStart = i;
        continue;
      }
      // not a raw string — fall through and treat `r` as ordinary code
    }

    // ---- normal / byte string
    if (c === '"' || (c === 'b' && c2 === '"')) {
      flushCode(i);
      const start = i;
      const isByte = c === 'b';
      let j = i + (isByte ? 2 : 1);
      const innerStart = j;
      // A backslash escapes the NEXT character whatever it is — including a
      // newline (line continuation). Advancing by two unconditionally is what
      // draft 2's `\\.` failed to do.
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '"') break;
        j++;
      }
      const innerEnd = Math.min(j, src.length);
      const end = j < src.length ? j + 1 : src.length;
      regions.push({
        kind: 'string',
        stringKind: isByte ? 'byte' : 'normal',
        start, end, innerStart, innerEnd,
      });
      i = end;
      codeStart = i;
      continue;
    }

    // ---- char literal vs lifetime
    // `'a'` is a char; `'a` is a lifetime and opens a quote that never closes.
    // Treating a lifetime as a string swallows the rest of the file.
    if (c === "'") {
      if (c2 === '\\') {
        // definitely a char literal: '\n', '\'', '\u{1F600}'
        let j = i + 2;
        while (j < src.length && src[j] !== "'") j++;
        i = j + 1;
        continue;
      }
      if (src[i + 2] === "'") { i += 3; continue; } // 'a'
      i += 1; // lifetime — consume only the tick
      continue;
    }

    i++;
  }
  flushCode(src.length);
  return regions;
}

/** Precompute line starts so an index maps to {line, col} in O(log n). */
function lineIndex(src) {
  const starts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') starts.push(i + 1);
  return (index) => {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= index) lo = mid; else hi = mid - 1;
    }
    return { line: lo + 1, col: index - starts[lo] + 1 };
  };
}

/**
 * Every string literal in `src`.
 *
 * @param {string} src Rust source
 * @param {{includeByte?: boolean}} [opts] includeByte defaults true
 * @returns {Array<{content:string, startLine:number, startCol:number, kind:string,
 *                  start:number, end:number, raw:string}>}
 */
export function extractRustStrings(src, opts = {}) {
  const includeByte = opts.includeByte !== false;
  const at = lineIndex(src);
  const out = [];
  for (const r of scanRust(src)) {
    if (r.kind !== 'string') continue;
    if (!includeByte && (r.stringKind === 'byte' || r.stringKind === 'byte-raw')) continue;
    const { line, col } = at(r.start);
    out.push({
      content: src.slice(r.innerStart, r.innerEnd),
      startLine: line,
      startCol: col,
      kind: r.stringKind,
      start: r.start,
      end: r.end,
      raw: src.slice(r.start, r.end),
    });
  }
  return out;
}

/**
 * Same-length copy of `src` with every string interior and every comment blanked
 * to spaces, newlines preserved.
 *
 * Byte offsets, line numbers and column numbers in the result are IDENTICAL to
 * the input — which is the property `stripCfgTest` brace-matches against and the
 * property the 16-line placement bug came from losing.
 */
export function maskRustLiteralsAndComments(src) {
  const buf = src.split('');
  const blank = (from, to) => {
    for (let k = from; k < to && k < buf.length; k++) {
      if (buf[k] !== '\n' && buf[k] !== '\r') buf[k] = ' ';
    }
  };
  for (const r of scanRust(src)) {
    if (r.kind === 'string') blank(r.innerStart, r.innerEnd);
    else if (r.kind === 'line-comment' || r.kind === 'block-comment') blank(r.start, r.end);
  }
  return buf.join('');
}
