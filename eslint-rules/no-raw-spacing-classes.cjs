/**
 * ESLint rule: no-raw-spacing-classes
 *
 * Warns when JSX className attributes contain raw Tailwind spacing classes
 * (p-*, px-*, py-*, space-y-*, gap-*) instead of semantic tokens from
 * designTokens.ts (CARD_PADDING, SECTION_GAP, LIST_ITEM_GAP, FORM_FIELD_GAP).
 *
 * Exempted files:
 *   - designTokens.ts (token definitions live here)
 *   - src/features/shared/components/** (foundational UI primitives)
 *   - src/lib/** (utility / design-system files)
 */

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Enforce semantic spacing tokens instead of raw Tailwind padding/gap classes",
    },
    messages: {
      rawSpacingClass:
        'Prefer a semantic spacing token (CARD_PADDING, SECTION_GAP, LIST_ITEM_GAP, FORM_FIELD_GAP) ' +
        'instead of raw "{{ raw }}". See designTokens.ts for the mapping.',
    },
    schema: [],
  },
  create(context) {
    const filename = context.filename || context.getFilename();

    // Normalise Windows backslashes so path checks work everywhere
    const norm = filename.replace(/\\/g, "/");

    // Skip files that are allowed to use raw spacing classes
    if (
      norm.includes("designTokens") ||
      norm.includes("src/features/shared/components/") ||
      norm.includes("src/lib/")
    ) {
      return {};
    }

    // Matches common raw Tailwind spacing utilities:
    //   p-{n}  px-{n}  py-{n}  pl-{n}  pr-{n}  pt-{n}  pb-{n}
    //   space-y-{n}  space-x-{n}  gap-{n}  gap-x-{n}  gap-y-{n}
    // where {n} is a number (with optional decimal like 1.5 or fraction like 1/2)
    // Excludes p-0, px-0, py-0 (reset values are fine)
    const RAW_SPACING_RE =
      /\b(p|px|py|pl|pr|pt|pb|space-y|space-x|gap|gap-x|gap-y)-(\d+(?:\.\d+)?(?:\/\d+)?)\b/;

    /**
     * Extract the string value from a JSX expression.
     * Handles: literal strings, template literals (static only).
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
      return [];
    }

    return {
      JSXAttribute(node) {
        if (node.name.name !== "className") return;

        const parts = extractStrings(node.value);
        for (const { value, node: reportNode } of parts) {
          const match = RAW_SPACING_RE.exec(value);
          if (match) {
            // Skip zero-value resets (p-0, px-0, etc.)
            if (match[2] === "0") continue;
            context.report({
              node: reportNode,
              messageId: "rawSpacingClass",
              data: { raw: match[0] },
            });
          }
        }
      },
    };
  },
};
