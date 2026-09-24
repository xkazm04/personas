/**
 * ESLint rule: no-raw-text-classes
 *
 * Warns when a JSX className sets type size by hand instead of through a
 * semantic typo-* class from typography.css:
 *   - raw Tailwind sizes (text-xs .. text-9xl)
 *   - arbitrary sizes (text-[11px], text-[0.8rem], text-[1.1em])
 *   - a typo-* name that no stylesheet defines (typo-body-sm, typo-overline):
 *     a phantom renders as inherited type while reading as tokenised
 *
 * A className is exempt only when it carries a REAL typo-* token. The real set
 * is read once, at rule load, from every `.typo-<name>` selector in src/**\/*.css
 * except *.proposed.css (the same derivation scripts/style/typo-allowlist.mjs uses for the census
 * rule phantom-typo-token). Before 2026-09-24 any class containing "typo-"
 * was exempt, so `typo-body-sm text-sm` passed twice: the phantom and the raw
 * size both hid behind a prefix.
 *
 * Mapping guide (the message names the token):
 *   text-xs / <=13px          -> typo-caption (typo-label when uppercase)
 *   text-sm / 14px            -> typo-body (typo-heading when bold/semibold)
 *   text-base / 15-16px       -> typo-body-lg
 *   text-lg                   -> typo-title-lg
 *   text-xl, text-2xl / 17-24px -> typo-heading-lg
 *   text-3xl+ / >24px         -> typo-hero
 *   font-mono + any size      -> typo-code (skipped: context decides)
 */
const fs = require("node:fs");
const path = require("node:path");

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "target", "coverage"]);

/** Every `.typo-<name>` class selector in src/**\/*.css, comments stripped. */
function readDefinedTypoNames(srcDir) {
  const names = new Set();
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(full);
      } else if (e.name.endsWith(".css") && !e.name.endsWith(".proposed.css")) {
        // *.proposed.css is a style proposal scoped under [data-style-proposal];
        // it defines no app token until promoted (same rule as typo-allowlist.mjs).
        const code = fs.readFileSync(full, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
        for (const m of code.matchAll(/\.typo-([a-z0-9]+(?:-[a-z0-9]+)*)(?![\w-])/g)) names.add(m[1]);
      }
    }
  };
  walk(srcDir);
  return names;
}

const DEFINED = readDefinedTypoNames(path.join(__dirname, "..", "src"));
// A reader that found nothing must not turn every typo-* class into a phantom.
// Failing loudly here would break the whole lint run, so it degrades to the
// pre-2026-09-24 behaviour (any typo-* exempts) and says so once.
const READER_OK = DEFINED.size > 0;
if (!READER_OK) {
  console.error("[no-raw-text-classes] read 0 typo-* names from src/**/*.css; phantom detection is OFF for this run");
}

const PHANTOM_SUGGESTIONS = {
  "body-sm": "typo-caption",
  "body-xs": "typo-caption",
  "body-strong": "typo-title",
  overline: "typo-label",
  "heading-xs": "typo-heading",
  "heading-sm": "typo-heading",
  "heading-md": "typo-heading",
  h3: "typo-heading-lg",
  h4: "typo-heading",
  h5: "typo-heading",
  "title-sm": "typo-title",
  display: "typo-hero",
  "data-md": "typo-data",
  button: "typo-heading",
};

const RAW_TEXT_RE = /\btext-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl)\b/;
const ARBITRARY_RE = /(?<![\w-])text-\[(\d*\.?\d+)(px|rem|em)\]/;
const TYPO_NAME_RE = /(?<![\w-])typo-([a-z0-9]+(?:-[a-z0-9]+)*)(?![\w-])/g;
const MONO_RE = /\bfont-mono\b/;
const IMPORTANT_RE = /!text-(xs|sm|base|lg|xl|2xl|3xl|4xl|\[)/;
const UPPER_RE = /\buppercase\b/;
const BOLD_RE = /\bfont-(bold|semibold|extrabold|black)\b/;

function typoNames(text) {
  return [...String(text).matchAll(TYPO_NAME_RE)].map((m) => m[1]);
}
/** True when the text carries a typo-* token some stylesheet really defines. */
function hasRealTypo(text) {
  const names = typoNames(text);
  if (!READER_OK) return names.length > 0;
  return names.some((n) => DEFINED.has(n));
}

function tokenForPx(px, fullText) {
  if (px <= 13) return UPPER_RE.test(fullText) ? "typo-label" : "typo-caption";
  if (px <= 14) return BOLD_RE.test(fullText) ? "typo-heading" : "typo-body";
  if (px <= 16) return "typo-body-lg";
  if (px <= 24) return "typo-heading-lg";
  return "typo-hero";
}
const SCALE_PX = { xs: 12, sm: 14, base: 16, lg: 18, xl: 20, "2xl": 24 };
function tokenForScale(size, fullText) {
  if (size === "lg") return "typo-title-lg";
  const px = SCALE_PX[size];
  return px === undefined ? "typo-hero" : tokenForPx(px, fullText);
}

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Enforce semantic typo-* classes instead of raw, arbitrary or undefined text-size classes",
    },
    messages: {
      rawTextClass:
        'Use "{{ token }}" instead of raw "{{ raw }}" (typography.css; .claude/Design.md section 2).',
      phantomTypo:
        '"{{ raw }}" is not defined by any stylesheet, so it renders as inherited type. Use "{{ token }}" (or another typo-* token from typography.css).',
    },
    schema: [],
  },
  create(context) {
    /**
     * Extract string values from a JSX expression.
     * Handles: literal strings, template literals, array.join() patterns,
     * and cn()/clsx() function call arguments.
     */
    function extractStrings(node) {
      if (!node) return [];

      if (node.type === "Literal" && typeof node.value === "string") {
        return [{ value: node.value, node }];
      }

      if (node.type === "TemplateLiteral") {
        return node.quasis.map((q) => ({ value: q.value.raw, node: q }));
      }

      if (node.type === "JSXExpressionContainer") {
        return extractStrings(node.expression);
      }

      // Handle array.join(' ') patterns: ['text-sm', ...].join(' ')
      if (
        node.type === "CallExpression" &&
        node.callee.type === "MemberExpression" &&
        node.callee.property.name === "join" &&
        node.callee.object.type === "ArrayExpression"
      ) {
        const results = [];
        for (const el of node.callee.object.elements) {
          if (el) results.push(...extractStrings(el));
        }
        return results;
      }

      // Handle cn(...), clsx(...), twMerge(...) function calls
      if (
        node.type === "CallExpression" &&
        node.callee.type === "Identifier" &&
        /^(cn|clsx|twMerge|classNames|cx)$/.test(node.callee.name)
      ) {
        const results = [];
        for (const arg of node.arguments) {
          results.push(...extractStrings(arg));
        }
        return results;
      }

      // Handle conditional (ternary) expressions: condition ? 'a' : 'b'
      if (node.type === "ConditionalExpression") {
        return [
          ...extractStrings(node.consequent),
          ...extractStrings(node.alternate),
        ];
      }

      return [];
    }

    /**
     * Collect all string fragments reachable from a className attribute
     * to check for mono context across the entire value.
     */
    function collectAllText(node) {
      return extractStrings(node)
        .map((p) => p.value)
        .join(" ");
    }

    return {
      JSXAttribute(node) {
        if (node.name.name !== "className") return;

        const parts = extractStrings(node.value);

        // Phantom typo-* names are reported wherever they appear, mono or not.
        if (READER_OK) {
          for (const { value, node: reportNode } of parts) {
            for (const name of typoNames(value)) {
              if (DEFINED.has(name)) continue;
              context.report({
                node: reportNode,
                messageId: "phantomTypo",
                data: {
                  raw: `typo-${name}`,
                  token: PHANTOM_SUGGESTIONS[name] || "typo-body",
                },
              });
            }
          }
        }

        // Full text for context checks: only a REAL typo-* token exempts.
        const fullText = collectAllText(node.value);
        if (hasRealTypo(fullText)) return; // already has a semantic class
        if (MONO_RE.test(fullText)) return; // mono context, skip

        for (const { value, node: reportNode } of parts) {
          if (IMPORTANT_RE.test(value)) continue; // intentional override

          const raw = RAW_TEXT_RE.exec(value);
          if (raw) {
            context.report({
              node: reportNode,
              messageId: "rawTextClass",
              data: { raw: raw[0], token: tokenForScale(raw[1], fullText) },
            });
            continue;
          }
          const arb = ARBITRARY_RE.exec(value);
          if (arb) {
            const n = Number(arb[1]);
            const px = arb[2] === "px" ? n : n * 16;
            context.report({
              node: reportNode,
              messageId: "rawTextClass",
              data: { raw: arb[0], token: tokenForPx(px, fullText) },
            });
          }
        }
      },
    };
  },
};
