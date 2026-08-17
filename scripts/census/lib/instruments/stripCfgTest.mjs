/**
 * stripCfgTest — remove `#[cfg(test)]` modules from Rust source WITHOUT MOVING
 * ANY SURVIVING LINE.
 *
 * THE RECORDED BUG THIS EMBODIES (golden-path doctrine §2):
 *
 *   "A third pair agreed on the finding and disagreed on where it is. Both
 *    reported the same count and the same defect; one placed a site 16 lines
 *    early, because its `#[cfg(test)]` stripper ate newlines. Agreement on
 *    *what* is not agreement on *where*, and a `file:line` is the part a reader
 *    acts on."
 *
 * So the contract is not "return the code without tests". It is: return a
 * string of THE SAME LINE COUNT, in which every surviving character sits on the
 * line it originally sat on. Stripped bytes become spaces; newlines are kept.
 * `stripCfgTest(src)` and `src` are interchangeable for any `file:line` report.
 *
 * The second half of the doctrine's mechanics note applies too:
 *
 *   "`#[cfg(test)]` exclusion must be a brace-matched range, never a
 *    line-number threshold. Test modules are not always at the end of the file.
 *    And a brace-matched range does not catch everything:
 *    `dev_tools_backlog_tests.rs` is a test file carrying no `#[cfg(test)]`
 *    attribute at all, so only a filename rule sees it."
 *
 * `isRustTestFile(relPath)` is that filename rule, exported beside the stripper
 * so a caller cannot take one and forget the other.
 */

import { maskRustLiteralsAndComments } from './extractRustStrings.mjs';

/**
 * Files that are test code without saying so in an attribute. A brace-matched
 * `#[cfg(test)]` range cannot see these — nothing in them is attributed.
 */
export function isRustTestFile(relPath) {
  const p = String(relPath).split('\\').join('/');
  const base = p.slice(p.lastIndexOf('/') + 1);
  return (
    /(^|\/)tests\//.test(p) ||
    /_tests?\.rs$/.test(base) ||
    /^tests?_/.test(base) ||
    /(^|\/)benches\//.test(p)
  );
}

/**
 * Blank every `#[cfg(test)]` item, preserving line structure.
 *
 * Matches the attribute in any spelling the tree uses:
 *   #[cfg(test)]
 *   #[cfg(all(test, feature = "x"))]
 *   #[cfg(any(test, doctest))]
 * i.e. a `cfg(...)` attribute containing `test` as a bare word.
 *
 * @param {string} src
 * @returns {{code: string, stripped: Array<{start:number, end:number, startLine:number, endLine:number}>}}
 */
export function stripCfgTestDetailed(src) {
  // Brace-match against a mask, never against the raw source: a `{` inside a
  // string literal or a comment closes the module early and silently truncates
  // the strip range. Offsets are identical, so ranges found here apply to `src`.
  const mask = maskRustLiteralsAndComments(src);
  const buf = src.split('');
  const stripped = [];

  const lineAt = (() => {
    const starts = [0];
    for (let i = 0; i < src.length; i++) if (src[i] === '\n') starts.push(i + 1);
    return (index) => {
      let lo = 0, hi = starts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (starts[mid] <= index) lo = mid; else hi = mid - 1;
      }
      return lo + 1;
    };
  })();

  const attrRe = /#\s*\[\s*cfg\s*\(/g;
  let m;
  while ((m = attrRe.exec(mask)) !== null) {
    const attrStart = m.index;
    // Balance the attribute's own parens to find where `cfg(...)` ends.
    let i = m.index + m[0].length - 1; // at the '('
    let depth = 0;
    for (; i < mask.length; i++) {
      if (mask[i] === '(') depth++;
      else if (mask[i] === ')') { depth--; if (depth === 0) { i++; break; } }
    }
    const cfgBody = mask.slice(m.index, i);
    if (!/\btest\b/.test(cfgBody)) continue;
    // consume the closing `]`
    while (i < mask.length && mask[i] !== ']') i++;
    i++;

    // The attributed item follows. Skip whitespace and any further attributes.
    let j = i;
    for (;;) {
      while (j < mask.length && /\s/.test(mask[j])) j++;
      if (mask[j] === '#') { // another attribute on the same item
        while (j < mask.length && mask[j] !== ']') j++;
        j++;
        continue;
      }
      break;
    }

    // Find the item's body. A `mod x { … }` / `fn x() { … }` ends at its
    // matching close brace; a `use …;` style item ends at the semicolon.
    let k = j;
    let end = -1;
    let sawBrace = false;
    let bdepth = 0;
    for (; k < mask.length; k++) {
      const ch = mask[k];
      if (ch === '{') { sawBrace = true; bdepth++; }
      else if (ch === '}') { bdepth--; if (bdepth === 0) { end = k + 1; break; } }
      else if (ch === ';' && !sawBrace && bdepth === 0) { end = k + 1; break; }
    }
    if (end === -1) end = mask.length;

    for (let p = attrStart; p < end; p++) {
      if (buf[p] !== '\n' && buf[p] !== '\r') buf[p] = ' ';
    }
    stripped.push({ start: attrStart, end, startLine: lineAt(attrStart), endLine: lineAt(end - 1) });
    attrRe.lastIndex = end;
  }

  return { code: buf.join(''), stripped };
}

/** The common form: just the line-preserving code. */
export function stripCfgTest(src) {
  return stripCfgTestDetailed(src).code;
}
