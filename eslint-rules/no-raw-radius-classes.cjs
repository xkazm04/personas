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
 *
 * The className walk (literals, templates, cn()/clsx(), join, ternaries) is
 * shared with the other design-token rules: see _classname-strings.cjs.
 */
const { createRawClassRule } = require("./_classname-strings.cjs");

/** @type {import('eslint').Rule.RuleModule} */
module.exports = createRawClassRule({
  description:
    "Enforce semantic radius tokens (rounded-interactive, rounded-input, rounded-card, rounded-modal) instead of raw Tailwind rounded-* scale classes",
  messageId: "rawRadiusClass",
  message:
    'Use a semantic radius token instead of "{{ raw }}". ' +
    "Mapping: rounded-sm → rounded-interactive, rounded-md → rounded-input, " +
    "rounded-lg → rounded-card, rounded-xl → rounded-modal.",
  // Matches raw Tailwind border-radius scale classes, with optional variant prefixes
  // and optional side modifiers (t-, b-, l-, r-, tl-, tr-, bl-, br-).
  // Does NOT match: rounded-none, rounded-full, rounded-pill, rounded-interactive,
  // rounded-input, rounded-card, rounded-modal, rounded-container, rounded-secondary,
  // rounded-[arbitrary].
  pattern: /(?:^|\s)((?:[a-z][a-z0-9-]*:)*rounded-(?:(?:t|b|l|r|tl|tr|bl|br)-)?(?:sm|md|lg|xl))(?:\s|$|")/,
  raw: (m) => m[1],
  exemptPaths: ["designTokens", "globals.css", "src/features/shared/components/", "src/lib/"],
});
