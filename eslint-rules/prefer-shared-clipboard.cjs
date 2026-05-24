/**
 * ESLint rule: prefer-shared-clipboard
 *
 * Flags direct `navigator.clipboard.writeText(...)` calls in feature code.
 * The project has a shared copy primitive that already handles the "copied!"
 * feedback, error handling, and a11y:
 *
 *   - `<CopyButton text={...} />` from
 *     `@/features/shared/components/buttons/CopyButton` (UI), or
 *   - `useCopyToClipboard()` from
 *     `@/hooks/utility/interaction/useCopyToClipboard` (logic only).
 *
 * Re-implementing clipboard writes inline means inconsistent feedback and
 * silently-swallowed failures. This is the cleanest of the shared-component
 * reuse signals (see docs/refactor/shared-component-reuse.md), so it's enforced.
 *
 * Allowed: the shared primitives themselves (the hook + CopyButton), which are
 * where the single real `navigator.clipboard.writeText` call should live.
 *
 * Opt out for a justified one-off with:
 *   // eslint-disable-next-line custom/prefer-shared-clipboard
 */

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Use the shared CopyButton / useCopyToClipboard instead of raw navigator.clipboard.writeText',
    },
    messages: {
      preferShared:
        'Avoid raw navigator.clipboard.writeText — use <CopyButton> from ' +
        '@/features/shared/components/buttons/CopyButton, or useCopyToClipboard() from ' +
        '@/hooks/utility/interaction/useCopyToClipboard (consistent copied-feedback + error handling). ' +
        'See docs/refactor/shared-component-reuse.md.',
    },
    schema: [],
  },
  create(context) {
    const filename = (
      typeof context.getFilename === 'function' ? context.getFilename() : context.filename
    ).replace(/\\/g, '/');

    // The shared primitives are allowed to own the single real call.
    if (/useCopyToClipboard\.|\/CopyButton\.tsx$/.test(filename)) return {};

    return {
      MemberExpression(node) {
        // match `<...>.clipboard.writeText`
        if (
          node.property &&
          node.property.name === 'writeText' &&
          node.object &&
          node.object.type === 'MemberExpression' &&
          node.object.property &&
          node.object.property.name === 'clipboard'
        ) {
          context.report({ node, messageId: 'preferShared' });
        }
      },
    };
  },
};
