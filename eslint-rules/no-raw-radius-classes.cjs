/**
 * ESLint rule: no-raw-radius-classes
 *
 * Warns when JSX className attributes contain raw Tailwind border-radius classes
 * (rounded-sm, rounded-md, rounded-lg, rounded-xl) instead of semantic radius
 * tokens (rounded-interactive, rounded-input, rounded-card, rounded-modal).
 *
 * The semantic radius system ensures consistent rounding:
 *   rounded-interactive — buttons, toggles, chips (6px)
 *   rounded-input       — inputs, selects, textareas (8px)
 *   rounded-card        — cards, panels, tiles (12px)
 *   rounded-modal       — modals, dialogs, sheets (16px)
 *   rounded-pill         — pills, badges (9999px) [allowed]
 *
 * Allowed: rounded-none, rounded-full, rounded-pill, rounded-interactive,
 *          rounded-input, rounded-card, rounded-modal, rounded-container,
 *          rounded-secondary, rounded-[arbitrary].
 *
 * Exempted files:
 *   - globals.css, designTokens.ts (token definitions)
 *   - src/features/shared/components/** (foundational UI primitives)
 *   - src/lib/** (utility / design-system files)
 */

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Enforce semantic radius tokens (rounded-interactive, rounded-input, rounded-card, rounded-modal) instead of raw Tailwind rounded-* scale classes",
    },
    messages: {
      rawRadiusClass:
        'Use a semantic radius token instead of "{{ raw }}". ' +
        "Mapping: rounded-sm → rounded-interactive, rounded-md → rounded-input, " +
        "rounded-lg → rounded-card, rounded-xl → rounded-modal.",
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
      norm.includes("src/features/shared/components/") ||
      norm.includes("src/lib/")
    ) {
      return {};
    }

    // Matches raw Tailwind border-radius scale classes, with optional variant prefixes
    // and optional side modifiers (t-, b-, l-, r-, tl-, tr-, bl-, br-).
    // Does NOT match: rounded-none, rounded-full, rounded-pill, rounded-interactive,
    // rounded-input, rounded-card, rounded-modal, rounded-container, rounded-secondary,
    // rounded-[arbitrary].
    const RAW_RADIUS_RE =
      /(?:^|\s)((?:[a-z][a-z0-9-]*:)*rounded-(?:(?:t|b|l|r|tl|tr|bl|br)-)?(?:sm|md|lg|xl))(?:\s|$|")/;

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
          const match = RAW_RADIUS_RE.exec(value);
          if (match) {
            context.report({
              node: reportNode,
              messageId: "rawRadiusClass",
              data: { raw: match[1] },
            });
          }
        }
      },
    };
  },
};
