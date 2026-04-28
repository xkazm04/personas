/**
 * ESLint rule: no-unmanaged-effect-resources
 *
 * Detects useEffect / useLayoutEffect bodies that allocate scheduled or
 * subscription-style resources without a matching cleanup in the effect's
 * return function. Catches the most common shape of the cleanup-gap class
 * surfaced by the 2026-04-27 bug-hunt scan (~28 findings, of which 7 closed
 * in Wave 4 and 4 closed in Wave 8c).
 *
 * v2 (2026-04-28) extended coverage to the four classes the v1 rule
 * intentionally skipped: Tauri `listen()`, native observer instances, and
 * `AbortController`. v1's "stricter shape" allocations (setInterval/timeout/
 * addEventListener) are unchanged.
 *
 * Caught patterns:
 *
 *   v1 (call → matching call cleanup):
 *     - setInterval(...) without clearInterval in cleanup
 *     - setTimeout(...) without clearTimeout in cleanup
 *     - <target>.addEventListener(...) without removeEventListener in cleanup
 *
 *   v2 (`new Constructor()` → matching method-call cleanup):
 *     - new ResizeObserver(...) / IntersectionObserver / MutationObserver /
 *       PerformanceObserver without a .disconnect() in cleanup
 *     - new AbortController() without a .abort() in cleanup
 *
 *   v2 (Tauri / async-promise allocation → cleanup function present):
 *     - listen(...) without ANY cleanup function returned (the unlisten
 *       contract is bespoke — `return () => unlistenP.then(fn => fn())` —
 *       so we only require that some cleanup exists, not that it call a
 *       specific method)
 *
 * Not caught (intentionally):
 *   - Aliased imports of listen / setInterval / etc. (rule matches by
 *     local-binding name only, no import-resolution)
 *   - Resources allocated inside helper functions defined within the effect
 *     body (deliberate scope limit — keeps the rule readable)
 *   - setIntervals stored in refs and cleared via helper functions called
 *     from the cleanup return — partially handled by collectAllReachableCalls
 *     descending into the cleanup body's nested helpers
 *
 * Severity: "warn". The rule is intentionally conservative and may have
 * false negatives — the goal is to surface the most common shapes during
 * code review, not to be a complete static analysis.
 */

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow useEffect bodies that allocate scheduled, listener, observer, or subscription resources without a matching cleanup return',
    },
    messages: {
      missingCleanupCall:
        'useEffect calls {{ resource }}() but the effect has no cleanup return — the resource will leak across effect re-runs and unmount. ' +
        'Return a cleanup function that calls {{ expected }}().',
      cleanupMissingMatchCall:
        'useEffect calls {{ resource }}() but its cleanup return does not call {{ expected }}() — the resource leaks across effect re-runs and unmount.',
      missingCleanupNew:
        'useEffect creates a new {{ resource }} but the effect has no cleanup return — the resource will leak. ' +
        'Return a cleanup function that calls .{{ expected }}() on it.',
      cleanupMissingMatchNew:
        'useEffect creates a new {{ resource }} but its cleanup return does not call .{{ expected }}() — the resource leaks.',
      missingCleanupListen:
        'useEffect calls listen(...) (Tauri event subscription) but the effect has no cleanup return — the listener will leak across effect re-runs and unmount. ' +
        'Capture the returned promise and unlisten in cleanup, e.g. `const unlistenP = listen(...); return () => { unlistenP.then((fn) => fn()); };`.',
    },
    schema: [],
  },
  create(context) {
    /** Allocation call name -> matching cleanup call name. */
    const CALL_RESOURCE_PAIRS = {
      setInterval: 'clearInterval',
      setTimeout: 'clearTimeout',
      addEventListener: 'removeEventListener',
    };
    const CALL_ALLOCATION_NAMES = Object.keys(CALL_RESOURCE_PAIRS);

    /** Constructor name -> matching cleanup method name (called as `.method()`). */
    const NEW_RESOURCE_PAIRS = {
      ResizeObserver: 'disconnect',
      IntersectionObserver: 'disconnect',
      MutationObserver: 'disconnect',
      PerformanceObserver: 'disconnect',
      AbortController: 'abort',
    };
    const NEW_ALLOCATION_NAMES = Object.keys(NEW_RESOURCE_PAIRS);

    /** Allocation calls that require *some* cleanup return but whose specific
     *  cleanup pattern is bespoke (Tauri listen — UnlistenFn promise pattern). */
    const ASYNC_ALLOCATION_NAMES = ['listen'];

    function getCalleeName(callOrNewExpr) {
      const c = callOrNewExpr.callee;
      if (!c) return null;
      if (c.type === 'Identifier') return c.name;
      if (c.type === 'MemberExpression' && c.property && c.property.type === 'Identifier') {
        return c.property.name;
      }
      return null;
    }

    /** Recursively walk an AST subtree and collect:
     *  - CallExpression nodes whose callee name matches `callNames`
     *  - NewExpression nodes whose callee name matches `newNames`
     *  Skips nested function declarations so we only count allocations
     *  executed when the effect itself runs, not those inside helpers it
     *  defines. */
    function collectAllocations(node, callNames, newNames, results) {
      if (!node || typeof node !== 'object' || !node.type) return;
      if (
        node.type === 'FunctionExpression' ||
        node.type === 'FunctionDeclaration' ||
        node.type === 'ArrowFunctionExpression'
      ) {
        return;
      }
      if (node.type === 'CallExpression') {
        const name = getCalleeName(node);
        if (name && callNames.includes(name)) {
          results.push({ node, name, kind: 'call' });
        }
      } else if (node.type === 'NewExpression') {
        const name = getCalleeName(node);
        if (name && newNames.includes(name)) {
          results.push({ node, name, kind: 'new' });
        }
      }
      for (const key of Object.keys(node)) {
        if (
          key === 'parent' ||
          key === 'loc' ||
          key === 'range' ||
          key === 'leadingComments' ||
          key === 'trailingComments'
        ) {
          continue;
        }
        const val = node[key];
        if (Array.isArray(val)) {
          for (const item of val) collectAllocations(item, callNames, newNames, results);
        } else if (val && typeof val === 'object' && val.type) {
          collectAllocations(val, callNames, newNames, results);
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
        if (
          key === 'parent' ||
          key === 'loc' ||
          key === 'range' ||
          key === 'leadingComments' ||
          key === 'trailingComments'
        ) {
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

        // Collect call-style and new-style allocations together.
        const allocations = [];
        const allCallNames = [...CALL_ALLOCATION_NAMES, ...ASYNC_ALLOCATION_NAMES];
        collectAllocations(callback.body, allCallNames, NEW_ALLOCATION_NAMES, allocations);
        if (allocations.length === 0) return;

        const cleanupFn = findCleanupFunction(callback);

        // Build the union of cleanup names we'd accept for any allocation
        // present in the effect — pre-compute the cleanup-body call set once
        // so per-allocation checks below are O(1).
        const expectedCleanupNames = new Set();
        for (const alloc of allocations) {
          if (alloc.kind === 'call') {
            const expected = CALL_RESOURCE_PAIRS[alloc.name];
            if (expected) expectedCleanupNames.add(expected);
          } else if (alloc.kind === 'new') {
            const expected = NEW_RESOURCE_PAIRS[alloc.name];
            if (expected) expectedCleanupNames.add(expected);
          }
          // ASYNC_ALLOCATION_NAMES (listen) doesn't have a single cleanup-call
          // shape — we just check that *some* cleanup function exists.
        }
        const cleanupCalls = [];
        if (cleanupFn && expectedCleanupNames.size > 0) {
          collectAllReachableCalls(
            cleanupFn.body,
            Array.from(expectedCleanupNames),
            cleanupCalls,
          );
        }
        const cleanupCallNames = new Set(cleanupCalls.map((c) => c.name));

        for (const alloc of allocations) {
          if (alloc.kind === 'call' && CALL_RESOURCE_PAIRS[alloc.name]) {
            const expected = CALL_RESOURCE_PAIRS[alloc.name];
            if (!cleanupFn) {
              context.report({
                node: alloc.node,
                messageId: 'missingCleanupCall',
                data: { resource: alloc.name, expected },
              });
              continue;
            }
            if (!cleanupCallNames.has(expected)) {
              context.report({
                node: alloc.node,
                messageId: 'cleanupMissingMatchCall',
                data: { resource: alloc.name, expected },
              });
            }
            continue;
          }

          if (alloc.kind === 'new' && NEW_RESOURCE_PAIRS[alloc.name]) {
            const expected = NEW_RESOURCE_PAIRS[alloc.name];
            if (!cleanupFn) {
              context.report({
                node: alloc.node,
                messageId: 'missingCleanupNew',
                data: { resource: alloc.name, expected },
              });
              continue;
            }
            if (!cleanupCallNames.has(expected)) {
              context.report({
                node: alloc.node,
                messageId: 'cleanupMissingMatchNew',
                data: { resource: alloc.name, expected },
              });
            }
            continue;
          }

          if (alloc.kind === 'call' && ASYNC_ALLOCATION_NAMES.includes(alloc.name)) {
            // Tauri listen / similar: require some cleanup function exists.
            // Don't try to match a specific cleanup-call name — the unlisten
            // contract is bespoke (.then(fn => fn()) or await + fn()).
            if (!cleanupFn) {
              context.report({
                node: alloc.node,
                messageId: 'missingCleanupListen',
                data: {},
              });
            }
            continue;
          }
        }
      },
    };
  },
};
