/**
 * ESLint rule: async-catch-requires-helper
 *
 * Flags `promise.catch(handler)` where `handler` is not one of the sanctioned
 * helpers from `@/lib/silentCatch` (`silentCatch`, `toastCatch`,
 * `silentCatchNull`). A non-empty inline handler (a raw `console.error`, a
 * local state update, a re-thrown error) still bypasses the Sentry breadcrumb
 * + telemetry rollup that the shared helpers provide — "it's not empty" is
 * not the same bar as "it's observable in production."
 *
 * Examples flagged:
 *
 *     somePromise.catch((err) => { console.error(err); });
 *     somePromise.catch(() => {});
 *     somePromise.catch((err) => { setError(err); });
 *     somePromise.catch(function (err) { log(err); });
 *
 * Examples allowed:
 *
 *     somePromise.catch(silentCatch('feature:context'));
 *     somePromise.catch(toastCatch('feature:action', 'Failed to save'));
 *     somePromise.catch(silentCatchNull('feature:context'));
 *     const onFail = silentCatch('feature:context');
 *     somePromise.catch(onFail);
 *     new Promise((resolve, reject) => {
 *       inner().catch(reject); // forwarding failure to the executor's reject
 *     });
 *
 * Also allowed: an inline handler that still delegates to a sanctioned
 * helper for the breadcrumb, but additionally needs a bit of local recovery
 * logic (resetting a cache, re-throwing, updating unrelated state) that a
 * bare `.catch(silentCatch(...))` can't express:
 *
 *     somePromise.catch((err) => {
 *       silentCatch('feature:context')(err);
 *       cachedValue = null; // allow a retry on the next call
 *     });
 *
 * The helper invocation must appear as one of the handler's own top-level
 * statements (not nested inside an if/try/etc — that's a signal the site
 * needs a human look, not a mechanical allowance).
 *
 * To opt out for a single site, prefix with `// eslint-disable-next-line
 * custom/async-catch-requires-helper` and a one-line reason.
 */

const HELPER_NAMES = new Set(["silentCatch", "toastCatch", "silentCatchNull"]);

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Require .catch() handlers to be one of the sanctioned helpers (silentCatch/toastCatch/silentCatchNull from @/lib/silentCatch) so swallowed errors leave a Sentry breadcrumb.",
    },
    messages: {
      rawCatchHandler:
        'This .catch() handler is not one of the sanctioned helpers (silentCatch, toastCatch, silentCatchNull from "@/lib/silentCatch"). ' +
        "A non-empty inline handler still bypasses the Sentry breadcrumb + swallow telemetry those helpers provide. " +
        "Use silentCatch(context) for background errors or toastCatch(context, message) when the user should see a toast.",
    },
    schema: [],
  },
  create(context) {
    // Local names bound to one of the sanctioned helpers, either via
    // `import { silentCatch } from "@/lib/silentCatch"` (optionally aliased)
    // or `const onFail = silentCatch("context")`.
    const localHelperImportNames = new Set();
    const localHelperBoundNames = new Set();

    // Does `expr` look like `helperName(...)(...)` — an immediately-invoked
    // call to one of the sanctioned helper factories?
    function isHelperInvocationExpression(expr) {
      return (
        expr &&
        expr.type === "CallExpression" &&
        expr.callee.type === "CallExpression" &&
        expr.callee.callee.type === "Identifier" &&
        localHelperImportNames.has(expr.callee.callee.name)
      );
    }

    // Does the handler function's body invoke a sanctioned helper as one of
    // its own top-level statements (or as its sole expression body)?
    function bodyDelegatesToHelper(fn) {
      if (fn.body.type !== "BlockStatement") {
        return isHelperInvocationExpression(fn.body);
      }
      return fn.body.body.some(
        (stmt) => stmt.type === "ExpressionStatement" && isHelperInvocationExpression(stmt.expression),
      );
    }

    return {
      ImportDeclaration(node) {
        const source = node.source.value;
        if (typeof source !== "string") return;
        if (!source.includes("silentCatch")) return;
        for (const spec of node.specifiers) {
          if (spec.type === "ImportSpecifier" && HELPER_NAMES.has(spec.imported.name)) {
            localHelperImportNames.add(spec.local.name);
          }
        }
      },
      VariableDeclarator(node) {
        if (
          node.init &&
          node.init.type === "CallExpression" &&
          node.init.callee.type === "Identifier" &&
          localHelperImportNames.has(node.init.callee.name) &&
          node.id.type === "Identifier"
        ) {
          localHelperBoundNames.add(node.id.name);
        }
      },
      CallExpression(node) {
        const callee = node.callee;
        if (
          callee.type !== "MemberExpression" ||
          callee.computed ||
          callee.property.type !== "Identifier" ||
          callee.property.name !== "catch"
        ) {
          return;
        }
        // Only flag the common single-handler form. `.catch()` with zero
        // args, or unusual multi-arg calls, aren't the pattern this rule
        // targets and are left alone to avoid false positives.
        if (node.arguments.length !== 1) return;

        const handler = node.arguments[0];

        // Case 1: direct call to a sanctioned helper — silentCatch('ctx')
        if (
          handler.type === "CallExpression" &&
          handler.callee.type === "Identifier" &&
          localHelperImportNames.has(handler.callee.name)
        ) {
          return;
        }

        // Case 2: a bare identifier reference.
        if (handler.type === "Identifier") {
          // 2a: a variable previously bound to a sanctioned helper call.
          if (localHelperBoundNames.has(handler.name)) return;
          // 2b: the idiomatic `reject` forwarding pattern inside a
          // `new Promise((resolve, reject) => { ... .catch(reject) })`
          // executor. Matching by name only (not full scope verification)
          // keeps the rule simple; `reject` as a bare .catch() argument
          // name is unambiguous in practice.
          if (handler.name === "reject") return;
        }

        // Case 3: an inline arrow/function handler that delegates to a
        // sanctioned helper for the breadcrumb, alongside other necessary
        // recovery logic (see module docstring).
        if (
          (handler.type === "ArrowFunctionExpression" || handler.type === "FunctionExpression") &&
          bodyDelegatesToHelper(handler)
        ) {
          return;
        }

        context.report({ node: handler, messageId: "rawCatchHandler" });
      },
    };
  },
};
