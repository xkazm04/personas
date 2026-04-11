/**
 * ESLint rule: no-hardcoded-jsx-text
 *
 * Flags JSX text content and string-literal attributes (placeholder, title,
 * aria-label) that contain hardcoded English instead of using the i18n system.
 *
 * This rule is a PREVENTIVE gate — it catches new hardcoded strings before they
 * enter the codebase. It does NOT require fixing all existing violations at once;
 * set it to "warn" and use the count as a progress metric during migration.
 *
 * Intentionally ignores:
 *   - Single characters, numbers, punctuation-only strings
 *   - className, style, key, data-*, type, id, name, htmlFor, role attributes
 *   - Files inside i18n/ directories (translation source files)
 *   - Files inside test/ or __tests__/ directories
 *   - Template literals with expressions (dynamic strings)
 *   - Strings that are only whitespace
 */

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Warn when JSX contains hardcoded English text instead of using the i18n translation system (useTranslation)',
    },
    messages: {
      hardcodedText:
        'Hardcoded text "{{text}}" should use the i18n system. ' +
        'Use `const { t } = useTranslation()` and replace with `t.section.key`.',
      hardcodedAttr:
        'Hardcoded "{{attr}}" attribute should use the i18n system. ' +
        'Use `const { t } = useTranslation()` and replace the string with `t.section.key`.',
    },
    schema: [],
  },
  create(context) {
    const filename = context.filename || context.getFilename();

    // Skip i18n source files, tests, and data files
    if (
      /[/\\]i18n[/\\]/.test(filename) ||
      /[/\\]__tests__[/\\]/.test(filename) ||
      /[/\\]test[/\\]/.test(filename) ||
      /\.test\.[jt]sx?$/.test(filename) ||
      /\.spec\.[jt]sx?$/.test(filename) ||
      /[/\\]data[/\\]/.test(filename)
    ) {
      return {};
    }

    // Attributes that are always technical (never user-facing)
    const SKIP_ATTRS = new Set([
      'className', 'style', 'key', 'id', 'name', 'htmlFor', 'role',
      'type', 'href', 'src', 'alt', 'to', 'as', 'ref', 'viewBox',
      'fill', 'stroke', 'd', 'cx', 'cy', 'r', 'x', 'y', 'width',
      'height', 'xmlns', 'transform', 'points', 'method', 'action',
      'autoComplete', 'inputMode', 'pattern', 'accept', 'encType',
      'target', 'rel', 'media', 'sizes', 'crossOrigin', 'loading',
      'decoding', 'fetchPriority',
    ]);

    // Attributes that carry user-facing text and should be translated
    const I18N_ATTRS = new Set([
      'placeholder', 'title', 'aria-label', 'aria-placeholder',
      'aria-roledescription', 'aria-valuetext',
    ]);

    /**
     * Returns true if the string looks like non-translatable content:
     * single chars, numbers, punctuation, CSS classes, code tokens, etc.
     */
    function isNonTranslatable(str) {
      const trimmed = str.trim();
      if (trimmed.length === 0) return true;
      if (trimmed.length <= 1) return true;
      // Pure numbers, punctuation, or symbols
      if (/^[\d\s.,;:!?@#$%^&*()\-+=<>{}[\]/\\|~`'"]+$/.test(trimmed)) return true;
      // CSS-like tokens (e.g. "flex", "px-2", "bg-white/50")
      if (/^[a-z][a-z0-9-]*(?:\/\d+)?$/.test(trimmed)) return true;
      // Single-word technical tokens (camelCase, snake_case, UPPER_CASE)
      if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmed) && trimmed.length <= 20) return true;
      return false;
    }

    return {
      // Flag hardcoded text nodes in JSX: <p>Some hardcoded text</p>
      JSXText(node) {
        const text = node.value;
        if (isNonTranslatable(text)) return;

        // Must contain at least 2 consecutive word characters to be "real" text
        if (!/[a-zA-Z]{2,}/.test(text)) return;

        context.report({
          node,
          messageId: 'hardcodedText',
          data: {
            text: text.trim().slice(0, 40) + (text.trim().length > 40 ? '...' : ''),
          },
        });
      },

      // Flag string literals in user-facing attributes
      JSXAttribute(node) {
        const attrName = node.name.type === 'JSXIdentifier'
          ? node.name.name
          : node.name.type === 'JSXNamespacedName'
            ? `${node.name.namespace.name}-${node.name.name.name}`
            : null;

        if (!attrName) return;

        // Skip technical attributes
        if (SKIP_ATTRS.has(attrName)) return;
        // Skip data-* attributes
        if (attrName.startsWith('data-')) return;
        // Skip on* event handlers
        if (attrName.startsWith('on') && attrName.length > 2 && attrName[2] === attrName[2].toUpperCase()) return;

        // Only flag known i18n-relevant attributes
        if (!I18N_ATTRS.has(attrName)) return;

        // Must be a string literal (not expression)
        if (!node.value || node.value.type !== 'Literal' || typeof node.value.value !== 'string') return;

        const text = node.value.value;
        if (isNonTranslatable(text)) return;

        context.report({
          node: node.value,
          messageId: 'hardcodedAttr',
          data: { attr: attrName },
        });
      },
    };
  },
};
