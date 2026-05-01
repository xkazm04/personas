/**
 * ESLint rule: no-direct-white-colors
 *
 * Forbids literal `text-white` / `bg-white` Tailwind classes in JSX className
 * values. Use the theme-aware `text-foreground` / `bg-secondary` tokens
 * instead — they invert under `[data-theme^="light"]` and stay legible across
 * every theme.
 *
 * What this rule flags:
 *   - `text-white`, `text-white/<N>` (any opacity)
 *   - `bg-white`, `bg-white/<N>` (any opacity)
 *
 * What this rule allows (legitimate exceptions):
 *   - Files under `src/features/shared/components/` — design-system primitives
 *     are allowed to use literal colors when they ship the theme contract
 *     (e.g. Button.tsx primary variant on a fixed-dark background).
 *   - Files under `src/lib/ui/` — same rationale.
 *   - `designTokens.ts` and any `*.css` (only relevant if eslint runs on it).
 *   - Lines opted out via `// eslint-disable-next-line` or a trailing
 *     `// white-ok: <reason>` comment.
 *
 * See `.claude/CLAUDE.md` → "Important Conventions → Styling".
 */

const path = require("node:path");

const EXEMPT_PATH_FRAGMENTS = [
  "src/features/shared/components",
  "src/lib/ui",
  "designTokens",
  "globals.css",
];

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Forbid literal text-white / bg-white in className. Use text-foreground or bg-secondary so the theme contract holds across light/dark.",
    },
    messages: {
      directWhite:
        'Avoid "{{ raw }}" — literal `text-white` / `bg-white` won\'t flip under [data-theme^="light"]. ' +
        "Use `text-foreground` (theme-aware) or `bg-secondary` instead. " +
        "See CLAUDE.md → Important Conventions → Styling.",
    },
    schema: [],
  },
  create(context) {
    const filename = context.filename || context.getFilename();
    const normalized = filename.replace(/\\/g, "/");
    if (EXEMPT_PATH_FRAGMENTS.some((frag) => normalized.includes(frag))) {
      return {};
    }

    // Match `text-white` or `bg-white`, optionally followed by `/<digits>`.
    // Anchored on a leading whitespace or string-start to avoid matching
    // inside e.g. `subtle-text-white-ish` accidentally.
    const WHITE_RE = /(?:^|[\s])((?:text|bg)-white(?:\/\d+)?)\b/;

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

      if (
        node.type === "CallExpression" &&
        node.callee.type === "MemberExpression" &&
        node.callee.property &&
        node.callee.property.name === "join" &&
        node.callee.object.type === "ArrayExpression"
      ) {
        const results = [];
        for (const el of node.callee.object.elements) {
          if (el) results.push(...extractStrings(el));
        }
        return results;
      }

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

      if (node.type === "ConditionalExpression") {
        return [
          ...extractStrings(node.consequent),
          ...extractStrings(node.alternate),
        ];
      }

      return [];
    }

    function findViolation(value) {
      const m = WHITE_RE.exec(value);
      if (m) return { raw: m[1] };
      return null;
    }

    return {
      JSXAttribute(node) {
        if (node.name.name !== "className") return;
        const parts = extractStrings(node.value);
        for (const { value, node: reportNode } of parts) {
          const violation = findViolation(value);
          if (violation) {
            context.report({
              node: reportNode,
              messageId: "directWhite",
              data: { raw: violation.raw },
            });
          }
        }
      },
    };
  },
};
