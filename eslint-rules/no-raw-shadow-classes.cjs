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
 *
 * The className walk (literals, templates, cn()/clsx(), join, ternaries) is
 * shared with the other design-token rules: see _classname-strings.cjs.
 */
const { createRawClassRule } = require("./_classname-strings.cjs");

/** @type {import('eslint').Rule.RuleModule} */
module.exports = createRawClassRule({
  description: "Enforce shadow-elevation-* tokens instead of raw Tailwind shadow scale classes",
  messageId: "rawShadowClass",
  message:
    'Use an elevation token instead of "{{ raw }}". ' +
    "Mapping: shadow-sm → shadow-elevation-1, shadow-md → shadow-elevation-2, " +
    "shadow-lg → shadow-elevation-3, shadow-xl → shadow-elevation-3, " +
    "shadow-2xl → shadow-elevation-4.",
  // Matches raw Tailwind shadow scale classes, with optional variant prefixes.
  // Does NOT match: drop-shadow-*, shadow-none, shadow-inner, shadow-elevation-*,
  // shadow-black, shadow-white, etc.
  pattern: /(?:^|\s)((?:[a-z][a-z0-9-]*:)*shadow-(?:sm|md|lg|xl|2xl))(?:\s|$|")/,
  raw: (m) => m[1],
  exemptPaths: ["designTokens", "globals.css", "src/lib/"],
});
