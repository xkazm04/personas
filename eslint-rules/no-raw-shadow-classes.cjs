/**
 * ESLint rule: no-raw-shadow-classes
 *
 * Warns when JSX className attributes contain raw Tailwind shadow classes
 * (shadow-sm, shadow-md, shadow-lg, shadow-xl, shadow-2xl) instead of
 * elevation-tier tokens (shadow-elevation-1 through shadow-elevation-4).
 *
 * The elevation system ensures consistent depth hierarchy:
 *   shadow-elevation-1 — cards, subtle surfaces
 *   shadow-elevation-2 — dropdowns, raised panels
 *   shadow-elevation-3 — modals, popovers
 *   shadow-elevation-4 — toasts, floating overlays
 *
 * Allowed: shadow-none, shadow-inner, drop-shadow-*, shadow-elevation-*,
 *          shadow-black/white (shadow colors).
 *
 * Exempted files:
 *   - globals.css, designTokens.ts (token definitions)
 *   - src/lib/** (utility / design-system files)
 */

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Enforce shadow-elevation-* tokens instead of raw Tailwind shadow scale classes",
    },
    messages: {
      rawShadowClass:
        'Use an elevation token instead of "{{ raw }}". ' +
        "Mapping: shadow-sm → shadow-elevation-1, shadow-md → shadow-elevation-2, " +
        "shadow-lg → shadow-elevation-3, shadow-xl → shadow-elevation-3, " +
        "shadow-2xl → shadow-elevation-4.",
    },
    schema: [],
  },
  create(context) {
    const filename = context.filename || context.getFilename();
    const norm = filename.replace(/\\/g, "/");

    // Skip token definitions and shared primitives
    if (
      norm.includes("designTokens") ||
      norm.includes("globals.css") ||
      norm.includes("src/lib/")
    ) {
      return {};
    }

    // Matches raw Tailwind shadow scale classes, with optional variant prefixes.
    // Does NOT match: drop-shadow-*, shadow-none, shadow-inner, shadow-elevation-*,
    // shadow-black, shadow-white, etc.
    const RAW_SHADOW_RE =
      /(?:^|\s)((?:[a-z][a-z0-9-]*:)*shadow-(?:sm|md|lg|xl|2xl))(?:\s|$|")/;

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
      return [];
    }

    return {
      JSXAttribute(node) {
        if (node.name.name !== "className") return;

        const parts = extractStrings(node.value);
        for (const { value, node: reportNode } of parts) {
          const match = RAW_SHADOW_RE.exec(value);
          if (match) {
            context.report({
              node: reportNode,
              messageId: "rawShadowClass",
              data: { raw: match[1] },
            });
          }
        }
      },
    };
  },
};
