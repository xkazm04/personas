/**
 * Patch d3-* modules for Tauri WebView2 + Vite dev mode compatibility.
 *
 * d3 modules assign to prototype properties (constructor, toString, etc.)
 * which throws "Cannot assign to read only property" in WebView2's strict
 * ESM context. This script rewrites those assignments to use
 * Object.defineProperty instead.
 *
 * Run automatically via npm postinstall.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', 'node_modules');

let patched = 0;

/**
 * Given source text starting at an opening '{', find the index of the
 * matching closing '}' by counting brace depth.
 */
function findMatchingBrace(src, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

function patchFile(filePath) {
  if (!existsSync(filePath)) return;
  let src = readFileSync(filePath, 'utf8');
  const original = src;

  // Pattern 1: prototype.constructor = constructor;
  // Found in d3-color/src/define.js
  src = src.replace(
    /prototype\.constructor\s*=\s*constructor;/g,
    "Object.defineProperty(prototype, 'constructor', { value: constructor, writable: true, configurable: true });"
  );

  // Pattern 2: X.prototype.toString = function() { ... multi-line ... };
  // We find the assignment, then brace-match the function body.
  // This handles toString specifically since it's a built-in that's read-only.
  const toStringRe = /(\w+)\.prototype\.toString\s*=\s*function\s*\([^)]*\)\s*\{/g;
  let match;
  while ((match = toStringRe.exec(src)) !== null) {
    const obj = match[1];
    if (['Array', 'Date', 'Object', 'String', 'Number'].includes(obj)) continue;

    const funcBodyStart = src.indexOf('{', match.index + match[0].length - 1);
    const funcBodyEnd = findMatchingBrace(src, funcBodyStart);
    if (funcBodyEnd === -1) continue;

    // Find the semicolon after the closing brace
    let endIndex = funcBodyEnd + 1;
    while (endIndex < src.length && /\s/.test(src[endIndex])) endIndex++;
    if (src[endIndex] === ';') endIndex++;

    const funcLiteral = src.slice(match.index + match[0].length - match[0].length + src.indexOf('function', match.index), funcBodyEnd + 1);
    // Extract just the function(...) { ... } part
    const fnStart = src.indexOf('function', match.index);
    const fnLiteral = src.slice(fnStart, funcBodyEnd + 1);

    const replacement = `Object.defineProperty(${obj}.prototype, 'toString', { value: ${fnLiteral}, writable: true, configurable: true });`;
    src = src.slice(0, match.index) + replacement + src.slice(endIndex);

    // Reset regex since we modified the string
    toStringRe.lastIndex = match.index + replacement.length;
  }

  // Pattern 3: selection.prototype.interrupt = selection_interrupt;
  // Simple single-value (non-function) prototype assignments to custom props
  // that might be on frozen prototypes. Only patch if the object is not a
  // standard built-in.
  // NOTE: We intentionally do NOT patch generic X.prototype.Y = function(){...}
  // patterns because those work fine — only built-in names like constructor
  // and toString are problematic.

  if (src !== original) {
    writeFileSync(filePath, src);
    patched++;
  }
}

// Scan all d3-* packages
for (const dir of readdirSync(root).filter(d => d.startsWith('d3-'))) {
  const srcDir = join(root, dir, 'src');
  if (!existsSync(srcDir)) continue;

  function walk(d) {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) patchFile(full);
    }
  }
  walk(srcDir);
}

console.log(`d3 patch: ${patched} file(s) patched for WebView2 compatibility`);
