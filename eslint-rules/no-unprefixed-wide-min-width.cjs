/**
 * ESLint rule: no-unprefixed-wide-min-width
 *
 * Flags an unprefixed `min-w-[Npx]` (N >= THRESHOLD_PX) Tailwind class in a
 * mobile-reachable feature surface. An unprefixed wide min-width is a HARD
 * floor: it forces horizontal overflow on a phone viewport (~360-430px CSS px).
 *
 * Why scoped to certain dirs?
 *   The app ships an Android build that only renders MOBILE_SECTIONS (home,
 *   overview, personas, design-reviews, credentials — see
 *   src/lib/utils/platform/platform.ts). A base min-width floor in one of those
 *   surfaces is a real mobile-overflow bug; the same class in a desktop-only
 *   surface (fleet, twin, pipeline, dev-tools, plugins) is harmless and would
 *   only be noise. So this rule only looks at the mobile-reachable dirs.
 *
 * How to satisfy the rule:
 *   - Gate the floor behind a breakpoint variant — `sm:min-w-[640px]` applies
 *     the floor at >=sm viewports and drops it below, letting a sibling
 *     `w-full` / `max-w-[…]` shrink the element to fit the phone. (This is the
 *     fix the mobile-overflow pass applied to the Glyph surfaces.)
 *   - Or, if the surface is genuinely desktop-only, add
 *     `// eslint-disable-next-line custom/no-unprefixed-wide-min-width`.
 */

const THRESHOLD_PX = 480;

// Feature dirs that render inside MOBILE_SECTIONS.
const MOBILE_REACHABLE = [
  "/features/home/",
  "/features/simple-mode/",
  "/features/overview/",
  "/features/personas/",
  "/features/agents/",
  "/features/vault/",
];

// A bare `min-w-[Npx]` whose preceding char is string-start, whitespace, or a
// quote — i.e. NOT preceded by `:` (so `sm:min-w-[…]` / `[@media…]:min-w-[…]`
// and compound tokens like `foo-min-w-[…]` are correctly skipped).
const BARE_WIDE_MIN_W = /(?:^|[\s"'`])min-w-\[(\d+)px\]/g;

function isMobileReachable(filename) {
  const norm = String(filename).replace(/\\/g, "/");
  return MOBILE_REACHABLE.some((d) => norm.includes(d));
}

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow unprefixed wide min-width in mobile-reachable surfaces.",
    },
    messages: {
      unprefixedWideMinW:
        "Unprefixed `min-w-[{{px}}px]` is a hard floor that forces horizontal " +
        "overflow on a phone (~360-430px) in a mobile-reachable surface. Gate it " +
        "behind a breakpoint (e.g. `sm:min-w-[{{px}}px]`) so it only applies at " +
        ">=sm viewports, or add an eslint-disable if this surface is desktop-only.",
    },
    schema: [],
  },
  create(context) {
    const filename = context.filename || context.getFilename();
    if (!isMobileReachable(filename)) return {};

    function scan(node, text) {
      if (!text) return;
      BARE_WIDE_MIN_W.lastIndex = 0;
      let m;
      while ((m = BARE_WIDE_MIN_W.exec(text)) !== null) {
        const px = parseInt(m[1], 10);
        if (px >= THRESHOLD_PX) {
          context.report({
            node,
            messageId: "unprefixedWideMinW",
            data: { px: String(px) },
          });
        }
      }
    }

    return {
      Literal(node) {
        if (typeof node.value === "string") scan(node, node.value);
      },
      TemplateElement(node) {
        scan(node, node.value && node.value.raw);
      },
    };
  },
};
