/**
 * ESLint rule: enforce-base-modal
 *
 * Flags files that use `role="dialog"` in JSX without importing BaseModal.
 * This catches custom modal implementations that should use the shared
 * BaseModal component (which provides focus trap, Escape handling, and
 * backdrop dismiss).
 */

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Enforce BaseModal usage for dialog components instead of custom implementations',
    },
    messages: {
      missingBaseModal:
        'This file uses role="dialog" but does not import BaseModal. ' +
        'Use the shared BaseModal component from @/lib/ui/BaseModal for consistent ' +
        'focus trap, Escape key handling, and backdrop dismiss behavior.',
    },
    schema: [],
  },
  create(context) {
    let importsBaseModal = false;
    let dialogRoleNode = null;

    return {
      ImportDeclaration(node) {
        const source = node.source.value;
        if (
          typeof source === 'string' &&
          (source.includes('BaseModal') || source.includes('lib/ui/BaseModal'))
        ) {
          importsBaseModal = true;
        }
      },
      JSXAttribute(node) {
        if (
          node.name.name === 'role' &&
          node.value &&
          node.value.type === 'Literal' &&
          node.value.value === 'dialog' &&
          !dialogRoleNode
        ) {
          dialogRoleNode = node;
        }
      },
      'Program:exit'() {
        if (dialogRoleNode && !importsBaseModal) {
          context.report({
            node: dialogRoleNode,
            messageId: 'missingBaseModal',
          });
        }
      },
    };
  },
};
