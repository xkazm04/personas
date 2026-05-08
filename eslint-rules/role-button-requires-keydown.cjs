/**
 * ESLint rule: role-button-requires-keydown
 *
 * Flags non-button JSX elements that opt into button semantics with
 * role="button" and onClick but do not provide keyboard activation.
 */

function getElementName(node) {
  if (!node || !node.name) return '';
  if (node.name.type === 'JSXIdentifier') return node.name.name;
  return '';
}

function getAttribute(node, name) {
  return (node.attributes || []).find(
    (attr) => attr.type === 'JSXAttribute' && attr.name && attr.name.name === name,
  );
}

function getStaticStringValue(attr) {
  if (!attr || !attr.value) return null;
  if (attr.value.type === 'Literal') return String(attr.value.value);
  if (
    attr.value.type === 'JSXExpressionContainer' &&
    attr.value.expression &&
    attr.value.expression.type === 'Literal'
  ) {
    return String(attr.value.expression.value);
  }
  return null;
}

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require keyboard handlers for non-button elements with role="button" and onClick',
    },
    messages: {
      missingKeyDown:
        'Element uses role="button" with onClick but has no onKeyDown handler. Use a real <button> or handle Enter/Space keyboard activation.',
    },
    schema: [],
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        if (getElementName(node) === 'button') {
          return;
        }
        const role = getStaticStringValue(getAttribute(node, 'role'));
        if (role !== 'button') {
          return;
        }
        if (!getAttribute(node, 'onClick')) {
          return;
        }
        if (getAttribute(node, 'onKeyDown')) {
          return;
        }
        context.report({ node, messageId: 'missingKeyDown' });
      },
    };
  },
};
