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
 *
 * The className walk (literals, templates, cn()/clsx(), join, ternaries) is
 * shared with the other design-token rules: see _classname-strings.cjs.
 */
const { createRawClassRule } = require("./_classname-strings.cjs");

/** @type {import('eslint').Rule.RuleModule} */
module.exports = createRawClassRule({
  description: "Enforce semantic spacing tokens instead of raw Tailwind padding/gap classes",
  messageId: "rawSpacingClass",
  message:
    "Prefer a semantic spacing token (CARD_PADDING, SECTION_GAP, LIST_ITEM_GAP, FORM_FIELD_GAP) " +
    'instead of raw "{{ raw }}". See designTokens.ts for the mapping.',
  // Matches common raw Tailwind spacing utilities:
  //   p-{n}  px-{n}  py-{n}  pl-{n}  pr-{n}  pt-{n}  pb-{n}
  //   space-y-{n}  space-x-{n}  gap-{n}  gap-x-{n}  gap-y-{n}
  // where {n} is a number (with optional decimal like 1.5 or fraction like 1/2)
  pattern: /\b(p|px|py|pl|pr|pt|pb|space-y|space-x|gap|gap-x|gap-y)-(\d+(?:\.\d+)?(?:\/\d+)?)\b/,
  // Zero-value resets (p-0, px-0, gap-0) are fine.
  ignore: (m) => m[2] === "0",
  exemptPaths: ["designTokens", "src/features/shared/components/", "src/lib/"],
});
