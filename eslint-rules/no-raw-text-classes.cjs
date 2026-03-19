/**
 * ESLint rule: no-raw-text-classes
 *
 * Warns when JSX className attributes contain raw Tailwind text-size classes
 * (text-xs, text-sm, text-base, text-lg, text-xl, text-2xl, text-3xl, text-4xl)
 * instead of semantic typo-* classes from typography.css.
 *
 * Mapping guide:
 *   text-4xl font-bold        → typo-hero
 *   text-xl  font-bold        → typo-heading-lg
 *   text-lg  font-bold        → typo-heading-lg
 *   text-sm  font-bold        → typo-heading
 *   text-sm  font-semibold    → typo-heading
 *   text-sm  (no weight)      → typo-body
 *   text-base (no weight)     → typo-body-lg
 *   text-xs  uppercase        → typo-label
 *   text-xs                   → typo-caption
 *   font-mono text-xs/text-sm → typo-code
 *   text-2xl font-bold + nums → typo-data-lg
 *   text-sm  tabular-nums     → typo-data
 */

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Enforce semantic typo-* classes instead of raw Tailwind text-size classes",
    },
    messages: {
      rawTextClass:
        'Prefer semantic typo-* class instead of raw "{{ raw }}". ' +
        "See typography.css for the mapping (e.g. typo-hero, typo-heading, typo-body, typo-caption).",
    },
    schema: [],
  },
  create(context) {
    // Matches text-xs through text-4xl (Tailwind default text-size utilities)
    const RAW_TEXT_RE =
      /\btext-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl)\b/;

    // Skip if the className already contains a typo-* class
    const TYPO_RE = /\btypo-/;

    // Skip font-mono paired text sizes — those map to typo-code but
    // the rule shouldn't auto-suggest when mono is present (context matters)
    const MONO_RE = /\bfont-mono\b/;

    // Skip Tailwind !important overrides (e.g. !text-xs) — intentional escapes
    const IMPORTANT_RE = /!text-(xs|sm|base|lg|xl|2xl|3xl|4xl)/;

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
      if (!node) return "";
      if (node.type === "Literal" && typeof node.value === "string") {
        return node.value;
      }
      if (node.type === "TemplateLiteral") {
        return node.quasis.map((q) => q.value.raw).join(" ");
      }
      if (node.type === "JSXExpressionContainer") {
        return collectAllText(node.expression);
      }
      if (
        node.type === "CallExpression" &&
        node.callee.type === "MemberExpression" &&
        node.callee.property.name === "join" &&
        node.callee.object.type === "ArrayExpression"
      ) {
        return node.callee.object.elements
          .map((el) => (el ? collectAllText(el) : ""))
          .join(" ");
      }
      if (
        node.type === "CallExpression" &&
        node.callee.type === "Identifier" &&
        /^(cn|clsx|twMerge|classNames|cx)$/.test(node.callee.name)
      ) {
        return node.arguments.map((a) => collectAllText(a)).join(" ");
      }
      if (node.type === "ConditionalExpression") {
        return [
          collectAllText(node.consequent),
          collectAllText(node.alternate),
        ].join(" ");
      }
      return "";
    }

    return {
      JSXAttribute(node) {
        if (node.name.name !== "className") return;

        // Collect full text for mono/typo context checks
        const fullText = collectAllText(node.value);
        if (TYPO_RE.test(fullText)) return; // already has semantic class
        if (MONO_RE.test(fullText)) return; // mono context, skip

        const parts = extractStrings(node.value);
        for (const { value, node: reportNode } of parts) {
          if (IMPORTANT_RE.test(value)) continue; // intentional override
          if (TYPO_RE.test(value)) continue; // already semantic
          if (MONO_RE.test(value)) continue; // mono context, skip

          const match = RAW_TEXT_RE.exec(value);
          if (match) {
            context.report({
              node: reportNode,
              messageId: "rawTextClass",
              data: { raw: match[0] },
            });
          }
        }
      },
    };
  },
};
