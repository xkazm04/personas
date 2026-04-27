/**
 * ESLint rule: no-unmanaged-effect-resources
 *
 * Detects useEffect / useLayoutEffect bodies that allocate scheduled or
 * subscription-style resources without a matching cleanup in the effect's
 * return function. Catches the most common shape of the cleanup-gap class
 * surfaced by the 2026-04-27 bug-hunt scan (~28 findings, of which 7 closed
 * in Wave 4 and 4 closed in Wave 8c).
 *
 * Caught patterns:
 *   - setInterval(...) without clearInterval in cleanup
 *   - setTimeout(...) without clearTimeout in cleanup
 *   - <target>.addEventListener(...) without removeEventListener in cleanup
 *   - window.addEventListener / document.addEventListener (same as above)
 *
 * Not caught (intentionally — to keep the rule a useful heuristic without
 * false-positive noise on patterns the project uses heavily):
 *   - Tauri listen() — returns an UnlistenFn promise; cleanup pattern is
 *     bespoke (.then(fn => fn())). Audit by hand.
 *   - ResizeObserver / IntersectionObserver / MutationObserver — instance
 *     lifecycle (.observe / .disconnect) is not call-site obvious.
 *   - AbortController — pairs with .abort() but allocations look like new
 *     AbortController() not a tracked call.
 *   - setIntervals stored in refs and cleared via helper functions.
 *
 * Severity: "warn". The rule is intentionally conservative and may have
 * false negatives — the goal is to surface the most common shape during
 * code review, not to be a complete static analysis.
 */

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow useEffect bodies that allocate scheduled or listener resources without a matching cleanup return',
    },
    messages: {
      missingCleanup:
        'useEffect calls {{ resource }}() but the effect has no cleanup return — the resource will leak across effect re-runs and unmount. ' +
        'Return a cleanup function that calls {{ expected }}().',
      cleanupMissingMatch:
        'useEffect calls {{ resource }}() but its cleanup return does not call {{ expected }}() — the resource leaks across effect re-runs and unmount.',
    },
    schema: [],
  },
  create(context) {
    /** Allocation -> matching cleanup name. */
    const RESOURCE_PAIRS = {
      setInterval: 'clearInterval',
      setTimeout: 'clearTimeout',
      addEventListener: 'removeEventListener',
    };
    const ALLOCATION_NAMES = Object.keys(RESOURCE_PAIRS);

    function getCalleeName(callExpr) {
      const c = callExpr.callee;
      if (!c) return null;
      if (c.type === 'Identifier') return c.name;
      if (c.type === 'MemberExpression' && c.property && c.property.type === 'Identifier') {
        return c.property.name;
      }
      return null;
    }

    /** Recursively walk an AST subtree and collect CallExpression nodes whose
     *  callee name (identifier or member-expression property) matches one of
     *  `names`. Skips nested function/arrow declarations so we only count
     *  calls in the effect body itself, not in helpers it defines. */
    function collectCalls(node, names, results) {
      if (!node || typeof node !== 'object' || !node.type) return;
      if (
        node.type === 'FunctionExpression' ||
        node.type === 'FunctionDeclaration' ||
        node.type === 'ArrowFunctionExpression'
      ) {
        // Don't recurse into nested function definitions — we want only calls
        // executed when the effect itself runs, not those inside helpers it
        // defines. This is a deliberate trade-off; nested helper-driven
        // allocations are a known false-negative.
        return;
      }
      if (node.type === 'CallExpression') {
        const name = getCalleeName(node);
        if (name && names.includes(name)) {
          results.push({ node, name });
        }
      }
      for (const key of Object.keys(node)) {
        if (key === 'parent' || key === 'loc' || key === 'range' || key === 'leadingComments' || key === 'trailingComments') {
          continue;
        }
        const val = node[key];
        if (Array.isArray(val)) {
          for (const item of val) collectCalls(item, names, results);
        } else if (val && typeof val === 'object' && val.type) {
          collectCalls(val, names, results);
        }
      }
    }

    /** For an effect callback (arrow or function expression), find the cleanup
     *  function: a top-level `return <fn>` whose argument is itself a function.
     *  Effects with implicit returns (concise arrow body) cannot be a cleanup. */
    function findCleanupFunction(effectCallback) {
      if (!effectCallback) return null;
      const body = effectCallback.body;
      if (!body) return null;
      if (body.type !== 'BlockStatement') {
        // Concise-body arrow returns its expression — not a function, so no cleanup.
        return null;
      }
      for (const stmt of body.body) {
        if (stmt.type === 'ReturnStatement' && stmt.argument) {
          const arg = stmt.argument;
          if (arg.type === 'ArrowFunctionExpression' || arg.type === 'FunctionExpression') {
            return arg;
          }
        }
      }
      return null;
    }

    /** Collect every cleanup-method name reachable from a function body —
     *  including calls inside nested helpers. Cleanups can legitimately be
     *  invoked indirectly (e.g. `return () => stop()` where stop calls
     *  clearInterval), and we don't want to over-flag those. */
    function collectAllReachableCalls(node, names, results, depth = 0) {
      if (depth > 8 || !node || typeof node !== 'object' || !node.type) return;
      if (node.type === 'CallExpression') {
        const name = getCalleeName(node);
        if (name && names.includes(name)) {
          results.push({ node, name });
        }
      }
      for (const key of Object.keys(node)) {
        if (key === 'parent' || key === 'loc' || key === 'range' || key === 'leadingComments' || key === 'trailingComments') {
          continue;
        }
        const val = node[key];
        if (Array.isArray(val)) {
          for (const item of val) collectAllReachableCalls(item, names, results, depth + 1);
        } else if (val && typeof val === 'object' && val.type) {
          collectAllReachableCalls(val, names, results, depth + 1);
        }
      }
    }

    return {
      CallExpression(node) {
        if (
          node.callee.type !== 'Identifier' ||
          (node.callee.name !== 'useEffect' && node.callee.name !== 'useLayoutEffect')
        ) {
          return;
        }
        const callback = node.arguments[0];
        if (
          !callback ||
          (callback.type !== 'ArrowFunctionExpression' && callback.type !== 'FunctionExpression')
        ) {
          return;
        }

        const allocations = [];
        collectCalls(callback.body, ALLOCATION_NAMES, allocations);
        if (allocations.length === 0) return;

        const cleanupFn = findCleanupFunction(callback);

        // Build the set of cleanup-method names actually invoked from the cleanup body.
        const expectedCleanupNames = Array.from(
          new Set(allocations.map((a) => RESOURCE_PAIRS[a.name])),
        );
        const cleanupCalls = [];
        if (cleanupFn) {
          collectAllReachableCalls(cleanupFn.body, expectedCleanupNames, cleanupCalls);
        }
        const cleanupCallNames = new Set(cleanupCalls.map((c) => c.name));

        for (const alloc of allocations) {
          const expected = RESOURCE_PAIRS[alloc.name];
          if (!cleanupFn) {
            context.report({
              node: alloc.node,
              messageId: 'missingCleanup',
              data: { resource: alloc.name, expected },
            });
            continue;
          }
          if (!cleanupCallNames.has(expected)) {
            context.report({
              node: alloc.node,
              messageId: 'cleanupMissingMatch',
              data: { resource: alloc.name, expected },
            });
          }
        }
      },
    };
  },
};
