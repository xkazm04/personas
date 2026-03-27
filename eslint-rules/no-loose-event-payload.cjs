/**
 * ESLint rule: no-loose-event-payload
 *
 * Bans `Record<string, unknown>` and index signatures `[key: string]: unknown`
 * inside the EventPayloadMap interface in eventRegistry.ts.
 * Concrete payload interfaces should be used instead.
 */

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Disallow Record<string, unknown> and index signatures in EventPayloadMap',
    },
    messages: {
      noLoosePayload:
        'EventPayloadMap entries must use concrete interfaces, not Record<string, unknown> or [key: string]: unknown. ' +
        'Define a named payload interface that mirrors the Rust emit struct.',
    },
    schema: [],
  },
  create(context) {
    let insideEventPayloadMap = false;

    return {
      // Track when we enter/leave the EventPayloadMap interface
      TSInterfaceDeclaration(node) {
        if (node.id && node.id.name === 'EventPayloadMap') {
          insideEventPayloadMap = true;
        }
      },
      'TSInterfaceDeclaration:exit'(node) {
        if (node.id && node.id.name === 'EventPayloadMap') {
          insideEventPayloadMap = false;
        }
      },

      // Catch Record<string, unknown> references
      TSTypeReference(node) {
        if (!insideEventPayloadMap) return;
        if (
          node.typeName &&
          node.typeName.name === 'Record' &&
          node.typeArguments &&
          node.typeArguments.params &&
          node.typeArguments.params.length === 2
        ) {
          const [keyParam, valueParam] = node.typeArguments.params;
          const isStringKey =
            keyParam.type === 'TSStringKeyword';
          const isUnknownValue =
            valueParam.type === 'TSUnknownKeyword';
          if (isStringKey && isUnknownValue) {
            context.report({ node, messageId: 'noLoosePayload' });
          }
        }
      },

      // Catch [key: string]: unknown index signatures
      TSIndexSignature(node) {
        if (!insideEventPayloadMap) return;
        if (
          node.typeAnnotation &&
          node.typeAnnotation.typeAnnotation &&
          node.typeAnnotation.typeAnnotation.type === 'TSUnknownKeyword'
        ) {
          context.report({ node, messageId: 'noLoosePayload' });
        }
      },
    };
  },
};
