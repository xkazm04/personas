/**
 * ESLint rule: no-whole-store-subscription
 *
 * Flags Zustand `useXxxStore()` calls with no selector argument. A whole-store
 * subscription causes the component to re-render on every state change across
 * the entire store — in this codebase that means hundreds of unrelated fields.
 *
 * The rule matches CallExpressions where:
 *   - callee is an Identifier matching /^use[A-Z]\w*Store$/
 *   - argument count is zero
 *
 * Member access like `useXxxStore.getState()`, `useXxxStore.setState()`, and
 * `useXxxStore.subscribe(...)` is unaffected because the callee is a
 * MemberExpression, not an Identifier.
 *
 * Always pass a selector:
 *   useAgentStore((s) => s.personas)                       — single field
 *   useAgentStore(useShallow((s) => ({ a: s.a, b: s.b }))) — multi-field via useShallow
 *
 * This rule encodes the load-bearing convention identified in /architect run
 * 2026-05-09 (state-management theme). See:
 *   .claude/codebase-stack.md § "State management: load-bearing patterns"
 *   $VAULT/Architect/strong-patterns.md § "Zustand consumption discipline"
 */

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow whole-store Zustand subscriptions — useXxxStore() with no selector causes re-render on every store change',
    },
    messages: {
      wholeStoreSub:
        'Whole-store Zustand subscription causes a re-render on every store change. ' +
        'Pass a selector: useXxxStore((s) => s.field), or for multi-field reads ' +
        'wrap in useShallow: useXxxStore(useShallow((s) => ({ a: s.a, b: s.b }))).',
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node) {
        if (
          node.arguments.length === 0 &&
          node.callee.type === 'Identifier' &&
          /^use[A-Z]\w*Store$/.test(node.callee.name)
        ) {
          context.report({ node, messageId: 'wholeStoreSub' });
        }
      },
    };
  },
};
