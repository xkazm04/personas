/**
 * ESLint rule: no-silent-catch
 *
 * Flags `catch` blocks that have zero statements (with or without a
 * justifying comment). These swallow errors entirely — no Sentry
 * breadcrumb, no log line, no trace of why the failure happened.
 *
 * The canonical fix is to use `silentCatch(context)` (background errors
 * — adds Sentry breadcrumb + console warn) or `toastCatch(context, msg)`
 * (user-visible errors — also surfaces a toast) from `@/lib/silentCatch`.
 *
 * Examples flagged:
 *
 *     try { x() } catch {}
 *     try { x() } catch (err) {}
 *     try { x() } catch {
 *       // intentional: non-critical -- localStorage cleanup
 *     }
 *
 * Examples allowed (have at least one statement in the catch body):
 *
 *     try { x() } catch (err) { silentCatch('feature:context')(err); }
 *     try { x() } catch (err) { toastCatch('feature:action', 'Failed')(err); }
 *     try { x() } catch (err) { dispatch({ type: 'FAILED', error: err }); }
 *     try { x() } catch (err) { return fallback; }
 *
 * If you genuinely need to swallow an error, do it with
 * `silentCatch('context')(err)` — it costs one line, posts a breadcrumb,
 * and means the next person debugging a production issue can find the
 * decision in the logs.
 *
 * To opt out for a single site, prefix with `// eslint-disable-next-line
 * custom/no-silent-catch` — but please leave a one-line comment on WHY
 * the error is uninteresting.
 */

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Flag empty catch blocks that swallow errors. Use silentCatch / toastCatch from @/lib/silentCatch instead.',
    },
    messages: {
      emptyCatch:
        'Empty catch block swallows the error. Use silentCatch(context) or toastCatch(context, message) from "@/lib/silentCatch" so the failure leaves a Sentry breadcrumb and a log line. ' +
        'A comment-only justification ("intentional: non-critical") is not enough — the next person debugging in production needs the breadcrumb, not the comment.',
    },
    schema: [],
  },
  create(context) {
    return {
      CatchClause(node) {
        // node.body is a BlockStatement; node.body.body is the array of statements.
        if (
          node.body &&
          node.body.type === 'BlockStatement' &&
          Array.isArray(node.body.body) &&
          node.body.body.length === 0
        ) {
          context.report({
            node: node.body,
            messageId: 'emptyCatch',
          });
        }
      },
    };
  },
};
