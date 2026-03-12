// WebView2 compatibility transform
//
// WebView2 treats inherited Object.prototype properties (toString, constructor,
// valueOf ...) as read-only AND non-configurable inside ESM strict-mode contexts.
// Libraries like es-toolkit, d3, and decimal.js assign to these properties
// directly, which throws at runtime.
//
// Fix: rewrite `X.prop = value` -> `Object.defineProperty(X, 'prop', { ... })`
// For chained assignments like `P.toString = P.valueOf = P.val = fn;`, decompose
// into an IIFE that assigns each target separately.

export const PROTECTED_PROPS = [
  "toString",
  "constructor",
  "valueOf",
  "toLocaleString",
];

const QUICK_CHECK = PROTECTED_PROPS.map((p) => `.${p} =`);

const BUILTIN_PREFIXES = [
  "Array",
  "Date",
  "Object",
  "String",
  "Number",
  "Boolean",
  "RegExp",
  "Function",
  "Map",
  "Set",
  "Promise",
];

export function needsTransform(code: string): boolean {
  return QUICK_CHECK.some((c) => code.includes(c));
}

function findMatchingBrace(code: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < code.length; i++) {
    if (code[i] === "{") depth++;
    else if (code[i] === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Check if a target like "P.valueOf" is a protected property assignment */
function getProtectedInfo(
  target: string,
): { obj: string; prop: string } | null {
  for (const prop of PROTECTED_PROPS) {
    if (target.endsWith("." + prop)) {
      const obj = target.slice(0, -(prop.length + 1));
      if (obj && /^[\w$]+(?:\.[\w$]+)*$/.test(obj)) {
        if (
          !BUILTIN_PREFIXES.some((b) => obj === b || obj.startsWith(b + "."))
        ) {
          return { obj, prop };
        }
      }
    }
  }
  return null;
}

/**
 * Split a value string on depth-0 `=` signs to decompose chained assignments.
 * Returns null if there are no chains (no depth-0 `=`).
 *
 * Example: "P.valueOf = P.val = fn" -> targets: ["P.valueOf", "P.val"], finalValue: "fn"
 */
function splitChain(
  valueStr: string,
): { targets: string[]; finalValue: string } | null {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  let inString: string | null = null;

  for (let i = 0; i < valueStr.length; i++) {
    const ch = valueStr[i];

    // Handle string literals
    if (inString) {
      if (ch === "\\" && i + 1 < valueStr.length) {
        i++; // skip escaped char
        continue;
      }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
      continue;
    }

    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    else if (ch === "=" && depth === 0) {
      // Skip ==, ===, =>, !=, <=, >=
      if (i + 1 < valueStr.length && (valueStr[i + 1] === "=" || valueStr[i + 1] === ">"))
        continue;
      if (
        i > 0 &&
        (valueStr[i - 1] === "!" ||
          valueStr[i - 1] === "<" ||
          valueStr[i - 1] === ">")
      )
        continue;

      parts.push(valueStr.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(valueStr.slice(start).trim());

  if (parts.length < 2) return null;

  return {
    targets: parts.slice(0, -1),
    finalValue: parts[parts.length - 1],
  };
}

/** Build an IIFE that decomposes a chained assignment */
function buildChainIIFE(
  outerTarget: string,
  outerProp: string,
  chainTargets: string[],
  finalValue: string,
): string {
  const lines: string[] = [];
  lines.push("(function() { var _v = " + finalValue + ";");

  // Process chain targets in reverse order (preserving right-to-left evaluation)
  for (let i = chainTargets.length - 1; i >= 0; i--) {
    const t = chainTargets[i];
    const info = getProtectedInfo(t);
    if (info) {
      lines.push(
        `Object.defineProperty(${info.obj}, '${info.prop}', { value: _v, writable: true, configurable: true });`,
      );
    } else {
      lines.push(`${t} = _v;`);
    }
  }

  // The outermost target (from the regex match)
  lines.push(
    `Object.defineProperty(${outerTarget}, '${outerProp}', { value: _v, writable: true, configurable: true });`,
  );
  lines.push("})()");

  return lines.join(" ");
}

function makeDefineProperty(
  target: string,
  prop: string,
  value: string,
): string {
  return `Object.defineProperty(${target}, '${prop}', { value: ${value}, writable: true, configurable: true })`;
}

export function transformForWebView2(code: string): string {
  if (!needsTransform(code)) return code;

  const propPattern = PROTECTED_PROPS.join("|");
  // =(?!=) ensures we match assignment `=` but NOT `==` or `===`
  const regex = new RegExp(
    `([\\w$]+(?:\\.[\\w$]+)*)\\.(${propPattern})\\s*=(?!=)\\s*`,
    "g",
  );

  const replacements: Array<{ start: number; end: number; text: string }> = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(code)) !== null) {
    const target = match[1];
    const prop = match[2];
    const valueStart = match.index + match[0].length;

    // Skip built-in prototypes (e.g. Array.prototype.map reads)
    if (
      BUILTIN_PREFIXES.some(
        (b) => target === b || target.startsWith(b + "."),
      )
    )
      continue;

    // Skip if line already contains defineProperty
    const lineStart = code.lastIndexOf("\n", match.index) + 1;
    if (code.slice(lineStart, match.index).includes("defineProperty"))
      continue;

    // Determine the extent of the assigned value
    const rest = code.slice(valueStart);
    let valueEndOffset: number;
    const trimmedRest = rest.trimStart();

    if (trimmedRest.startsWith("function")) {
      // Function literal -- use brace matching
      const braceIdx = rest.indexOf("{");
      if (braceIdx === -1) continue;
      const closeIdx = findMatchingBrace(rest, braceIdx);
      if (closeIdx === -1) continue;
      valueEndOffset = closeIdx + 1;
    } else {
      // Find the end: semicolon at depth 0, respecting nesting
      let depth = 0;
      let found = -1;
      for (let i = 0; i < rest.length; i++) {
        const ch = rest[i];
        if (ch === "(" || ch === "[" || ch === "{") depth++;
        else if (ch === ")" || ch === "]" || ch === "}") depth--;
        else if (ch === ";" && depth === 0) {
          found = i;
          break;
        }
      }
      if (found === -1) continue;
      valueEndOffset = found;

      // If the value itself contains a chain (e.g., P.valueOf = P.val = function() { ... };)
      // we need to check if "function" appears in the value after some chain targets.
      // The semicolon approach correctly finds the end because it tracks nesting.
    }

    const valueStr = code.slice(valueStart, valueStart + valueEndOffset).trim();

    // Consume trailing whitespace + semicolon
    let endIdx = valueStart + valueEndOffset;
    while (endIdx < code.length && /\s/.test(code[endIdx])) endIdx++;
    const hasSemi = endIdx < code.length && code[endIdx] === ";";
    if (hasSemi) endIdx++;

    // Check if value contains chained protected property assignments
    const chain = splitChain(valueStr);
    const hasInnerProtected =
      chain !== null && chain.targets.some((t) => getProtectedInfo(t) !== null);

    let replacement: string;
    if (hasInnerProtected && chain) {
      // Decompose chained assignment into IIFE
      replacement = buildChainIIFE(
        target,
        prop,
        chain.targets,
        chain.finalValue,
      );
      if (hasSemi) replacement += ";";
    } else {
      replacement =
        makeDefineProperty(target, prop, valueStr) + (hasSemi ? ";" : "");
    }

    replacements.push({ start: match.index, end: endIdx, text: replacement });

    // Advance past the captured value to prevent overlapping matches
    regex.lastIndex = endIdx;
  }

  if (replacements.length === 0) return code;

  // Apply in reverse to preserve indices
  let result = code;
  for (let i = replacements.length - 1; i >= 0; i--) {
    const r = replacements[i];
    result = result.slice(0, r.start) + r.text + result.slice(r.end);
  }
  return result;
}
