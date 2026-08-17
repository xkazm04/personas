/**
 * matchJsxTags — JSX element OPEN TAGS for named components, generic-aware.
 *
 * THE RECORDED BUG THIS EMBODIES (golden-path doctrine §4, "Enumerate the
 * operators that contain your delimiters"):
 *
 *   "Two matcher bugs in one leaf, each caught only because two implementations
 *    disagreed: a TSX generic (`<UnifiedTable<PersonaEvent>`) closed a scanner's
 *    opening tag at its own `>`, reporting 2 of 17 virtualized when the truth
 *    was 6; then a census pattern missed a real site because `errPct >= 10` puts
 *    a `>` outside `(?:=>|[^<>])`. If your delimiter is `<` or `>`, list `=>`,
 *    `>=`, `<=` before you run."
 *
 * Three independent composers hit this. The direction of the error is what
 * makes it expensive: a tag that closes early under-reports exactly the
 * CAREFULLY-TYPED call sites — the ones a reviewer is least likely to suspect
 * and most likely to be the correct exemplar.
 *
 * The fix is not a longer character class. It is depth tracking:
 *   - `<`/`>` inside a type argument list nest (`<Foo<Bar<Baz>>>`);
 *   - `{ … }` attribute expressions are opaque, so `=>`, `>=`, `<=`, `<` and `>`
 *     inside them are arithmetic/arrows and are never tag delimiters;
 *   - string and template literals are opaque for the same reason.
 *
 * Only the OPEN tag is matched. Closing tags (`</Foo>`), fragments (`<>`) and
 * lowercase intrinsics (`<div>`) are not components and are skipped — pass
 * `{ intrinsics: true }` if you want `<div>` too.
 */

/** `Foo`, `Foo.Bar`, `Foo.Bar.Baz` — a component reference. */
const COMPONENT_HEAD = /[A-Z][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*/y;
const INTRINSIC_HEAD = /[a-z][a-zA-Z0-9.\-_$]*/y;

function lineIndexer(src) {
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
 * @param {string} src TSX/JSX source
 * @param {{names?: string[]|RegExp, intrinsics?: boolean}} [opts]
 *   names — restrict to these component names (exact, or a RegExp tested
 *   against the name). Omit for every component.
 * @returns {Array<{name:string, start:number, end:number, line:number, col:number,
 *                  selfClosing:boolean, generic:string|null, attrs:string, raw:string}>}
 */
export function matchJsxTags(src, opts = {}) {
  const at = lineIndexer(src);
  const wanted = opts.names;
  const nameOk = (n) => {
    if (!wanted) return true;
    if (wanted instanceof RegExp) return wanted.test(n);
    return wanted.includes(n);
  };

  const out = [];
  for (let i = 0; i < src.length; i++) {
    if (src[i] !== '<') continue;
    const next = src[i + 1];
    if (next === '/' || next === '>' || next === '!' || next === '=' || next === undefined) continue;

    const head = opts.intrinsics && /[a-z]/.test(next) ? INTRINSIC_HEAD : COMPONENT_HEAD;
    head.lastIndex = i + 1;
    const nm = head.exec(src);
    if (!nm || nm.index !== i + 1) continue;
    const name = nm[0];

    // The char after the name must be able to follow a tag name. `a < b` and
    // `x <Foo` in arithmetic position are excluded by this alone.
    const after = src[i + 1 + name.length];
    if (after !== undefined && !/[\s/>{<]/.test(after)) continue;

    const parsed = scanOpenTag(src, i + 1 + name.length);
    if (!parsed) continue;
    if (!nameOk(name)) { i = parsed.end - 1; continue; }

    const { line, col } = at(i);
    out.push({
      name,
      start: i,
      end: parsed.end,
      line,
      col,
      selfClosing: parsed.selfClosing,
      generic: parsed.generic,
      attrs: parsed.attrs,
      raw: src.slice(i, parsed.end),
    });
    i = parsed.end - 1;
  }
  return out;
}

/**
 * From just past the tag name to the `>` that really closes the tag.
 * Returns null when no close is found (truncated file / not a tag at all).
 */
function scanOpenTag(src, from) {
  let i = from;
  let angle = 0;   // depth of type-argument `<…>`
  let brace = 0;   // depth of `{…}` attribute expressions
  let paren = 0;   // depth of `(…)` inside those expressions
  let genericEnd = -1;

  // A generic, if present, is glued to the name: `<UnifiedTable<PersonaEvent>`.
  const hasGeneric = src[i] === '<';

  while (i < src.length) {
    const c = src[i];

    // ---- opaque regions: strings and template literals
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      i++;
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === quote) { i++; break; }
        // A template literal's `${…}` can itself contain quotes; treat the
        // whole literal as opaque, which is enough — we only need to not see
        // its `<`/`>`.
        i++;
      }
      continue;
    }

    // ---- comments inside a tag: {/* … */} and // in expressions
    if (c === '/' && src[i + 1] === '*') {
      i = src.indexOf('*/', i + 2);
      i = i === -1 ? src.length : i + 2;
      continue;
    }

    if (c === '{') { brace++; i++; continue; }
    if (c === '}') { brace--; i++; continue; }

    if (brace > 0) {
      // Inside an attribute expression EVERYTHING angular is arithmetic or an
      // arrow: `=>`, `>=`, `<=`, `<`, `>`. This is the second half of the
      // recorded bug (`errPct >= 10`) and it is handled structurally, not by
      // enumerating operators into a character class.
      if (c === '(') paren++;
      else if (c === ')') paren--;
      i++;
      continue;
    }

    if (c === '<') { angle++; i++; continue; }

    if (c === '>') {
      if (angle > 0) {
        angle--;
        i++;
        if (angle === 0 && genericEnd === -1 && hasGeneric) genericEnd = i;
        continue;
      }
      const selfClosing = src[i - 1] === '/';
      return {
        end: i + 1,
        selfClosing,
        generic: genericEnd > from ? src.slice(from, genericEnd) : null,
        attrs: src.slice(genericEnd > from ? genericEnd : from, selfClosing ? i - 1 : i),
      };
    }

    i++;
  }
  return null;
}
