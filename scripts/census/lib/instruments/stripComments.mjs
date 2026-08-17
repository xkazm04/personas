/**
 * stripComments — blank `//` and `/* … *\/` comments in JS/TS/Rust WITHOUT
 * eating URLs and WITHOUT touching string interiors.
 *
 * THE RECORDED BUG THIS EMBODIES (golden-path doctrine §2, "Assert the
 * instrument before you trust the result"):
 *
 *   "`scripts/check-csp-hosts.mjs` reported ZERO frontend fetch hosts twice, for
 *    two unrelated reasons — first because it anchored on the `fetch(...)`
 *    argument list when the URL is assembled several statements earlier, then
 *    because ITS COMMENT STRIPPER ATE THE URLS (`https://` contains `//`, so a
 *    naive line-comment regex blanks the rest of every line holding a URL).
 *    Without the exit-2 guard, both versions would have exited 0 and looked like
 *    working gates indefinitely."
 *
 * Two independent defences, because the failure was silent and expensive:
 *   1. A scanner, not a regex — a `//` inside a string literal is inside a
 *      string literal, so it is never a comment. This is the structural fix.
 *   2. The `(?<!:)` guard the doctrine names: a `//` immediately preceded by `:`
 *      is a scheme separator, never a comment opener. Redundant with (1) for
 *      well-formed source, and the thing that saves you when the string scanner
 *      loses sync on a file it has never seen (a JSX text node, a Rust macro
 *      body). Belt AND suspenders was the whole lesson of that gate.
 *
 * Line structure is preserved: comment bytes become spaces, newlines survive.
 * `stripComments(src).length === src.length`, so every `file:line` and every
 * byte offset computed on the result is true of the original — the same
 * property `stripCfgTest` exists to protect.
 */

import { scanRust } from './extractRustStrings.mjs';

/**
 * @param {string} src
 * @param {{lang?: 'js'|'ts'|'tsx'|'jsx'|'rust'}} [opts] default 'js'
 * @returns {string} same length as `src`, comments blanked to spaces
 */
export function stripComments(src, opts = {}) {
  const lang = opts.lang ?? 'js';
  if (lang === 'rust') return stripRustComments(src);
  return stripJsComments(src);
}

function blankRange(buf, from, to) {
  for (let k = from; k < to && k < buf.length; k++) {
    if (buf[k] !== '\n' && buf[k] !== '\r') buf[k] = ' ';
  }
}

function stripRustComments(src) {
  const buf = src.split('');
  for (const r of scanRust(src)) {
    if (r.kind === 'line-comment' || r.kind === 'block-comment') blankRange(buf, r.start, r.end);
  }
  return buf.join('');
}

/**
 * JS/TS scanner. Regex literals are the one construct that can contain a `/`
 * without opening a comment; they are detected by the "what can precede a
 * regex" rule (an operator or a keyword, never an identifier/`)`/`]`).
 */
function stripJsComments(src) {
  const buf = src.split('');
  let i = 0;
  let prevSignificant = ''; // last non-space code char seen

  while (i < src.length) {
    const c = src[i];
    const c2 = src[i + 1];

    // ---- strings & template literals: opaque
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      i++;
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === quote) { i++; break; }
        i++;
      }
      prevSignificant = quote;
      continue;
    }

    // ---- line comment
    if (c === '/' && c2 === '/') {
      // The URL guard. `https://host` reaches here only if the string scanner
      // lost sync; when it does, this is the difference between "one host
      // missed" and "every host on the line missed".
      if (src[i - 1] === ':') { i += 2; continue; }
      const start = i;
      while (i < src.length && src[i] !== '\n') i++;
      blankRange(buf, start, i);
      continue;
    }

    // ---- block comment
    if (c === '/' && c2 === '*') {
      const start = i;
      const close = src.indexOf('*/', i + 2);
      i = close === -1 ? src.length : close + 2;
      blankRange(buf, start, i);
      continue;
    }

    // ---- regex literal: /…/flags, only where a value may start
    if (c === '/' && canPrecedeRegex(prevSignificant)) {
      let j = i + 1;
      let inClass = false;
      let closed = false;
      while (j < src.length) {
        const d = src[j];
        if (d === '\\') { j += 2; continue; }
        if (d === '\n') break;            // unterminated — not a regex after all
        if (d === '[') inClass = true;
        else if (d === ']') inClass = false;
        else if (d === '/' && !inClass) { closed = true; j++; break; }
        j++;
      }
      if (closed) {
        while (j < src.length && /[a-z]/.test(src[j])) j++; // flags
        i = j;
        prevSignificant = '/';
        continue;
      }
    }

    if (!/\s/.test(c)) prevSignificant = c;
    i++;
  }
  return buf.join('');
}

/** A `/` starts a regex literal only after an operator, punctuator or keyword. */
function canPrecedeRegex(prev) {
  if (prev === '') return true;
  return '(,=:[!&|?{};+-*%^~<>'.includes(prev);
}
