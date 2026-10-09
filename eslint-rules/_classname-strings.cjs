/**
 * Shared className reader for the design-token lint rules (not a rule itself).
 *
 * Before 2026-10-09 each of no-raw-text-classes, no-raw-radius-classes,
 * no-raw-shadow-classes and no-raw-spacing-classes carried its own copy of
 * "get the static class strings out of this className", at two depths:
 * the text rule followed cn()/clsx() arguments, `[..].join(' ')` and ternaries,
 * the other three stopped at template literals and so never saw
 * `className={cn("rounded-lg", x)}` (docs/concepts/golden-paths/custom-lint-rule.md
 * section F). None of the copies walked `cond && "class"`, the commonest cn()
 * argument. One walker now gives all four the deep shape, and a design-token
 * family that only bans a pattern is one createRawClassRule() declaration.
 */

/** Class-merging helpers whose arguments are class strings. */
const CLASS_HELPER_RE = /^(cn|clsx|twMerge|classNames|cx)$/;

/**
 * Every static string fragment reachable from a className value, each paired
 * with the node a report should point at.
 * Handles: string literals, template-literal quasis, JSX expression containers,
 * `[..].join(' ')`, cn()/clsx()/twMerge()/classNames()/cx() arguments, both
 * arms of a ternary and both sides of `&&` / `||` / `??`. Anything else (an identifier, a member read, a call to an
 * unknown function) yields no fragments: its value is not knowable statically.
 *
 * @param {import('estree').Node | null | undefined} node
 * @returns {{ value: string, node: import('estree').Node }[]}
 */
function extractClassStrings(node) {
  if (!node) return [];

  switch (node.type) {
    case "Literal":
      return typeof node.value === "string" ? [{ value: node.value, node }] : [];

    case "TemplateLiteral":
      return node.quasis.map((q) => ({ value: q.value.raw, node: q }));

    case "JSXExpressionContainer":
      return extractClassStrings(node.expression);

    case "ConditionalExpression":
      return [...extractClassStrings(node.consequent), ...extractClassStrings(node.alternate)];

    // cn("flex", active && "rounded-lg") / cls || "rounded-md": either side may
    // be a class string; the guard side is usually a boolean and yields nothing.
    case "LogicalExpression":
      return [...extractClassStrings(node.left), ...extractClassStrings(node.right)];

    case "CallExpression": {
      const { callee } = node;
      // ['a', 'b'].join(' ')
      if (
        callee.type === "MemberExpression" &&
        callee.property.name === "join" &&
        callee.object.type === "ArrayExpression"
      ) {
        return callee.object.elements.flatMap((el) => extractClassStrings(el));
      }
      // cn(...), clsx(...), twMerge(...), classNames(...), cx(...)
      if (callee.type === "Identifier" && CLASS_HELPER_RE.test(callee.name)) {
        return node.arguments.flatMap((arg) => extractClassStrings(arg));
      }
      return [];
    }

    default:
      return [];
  }
}

/** All fragments of a className value joined into one string, for whole-value context checks. */
function collectClassText(node) {
  return extractClassStrings(node)
    .map((p) => p.value)
    .join(" ");
}

/** True when the className attribute's name is literally `className`. */
function isClassNameAttribute(node) {
  return node.name && node.name.name === "className";
}

/**
 * Build a rule that reports every className fragment matching `pattern`.
 *
 * @param {object} spec
 * @param {string} spec.description      meta.docs.description
 * @param {string} spec.messageId        the single message id this rule reports
 * @param {string} spec.message          message text; `{{ raw }}` is the matched class
 * @param {RegExp} spec.pattern          non-global; tested against each fragment
 * @param {string[]} [spec.exemptPaths]  substrings of a forward-slash file path that turn the rule off
 * @param {(m: RegExpExecArray) => string} [spec.raw]   the class to name in the message (default: whole match)
 * @param {(m: RegExpExecArray) => boolean} [spec.ignore] true for a match that is legal after all
 * @returns {import('eslint').Rule.RuleModule}
 */
function createRawClassRule({
  description,
  messageId,
  message,
  pattern,
  exemptPaths = [],
  raw = (m) => m[0],
  ignore = () => false,
}) {
  return {
    meta: {
      type: "suggestion",
      docs: { description },
      messages: { [messageId]: message },
      schema: [],
    },
    create(context) {
      const filename = (context.filename || context.getFilename()).replace(/\\/g, "/");
      if (exemptPaths.some((p) => filename.includes(p))) return {};

      return {
        JSXAttribute(node) {
          if (!isClassNameAttribute(node)) return;
          for (const { value, node: reportNode } of extractClassStrings(node.value)) {
            const match = pattern.exec(value);
            if (!match || ignore(match)) continue;
            context.report({ node: reportNode, messageId, data: { raw: raw(match) } });
          }
        },
      };
    },
  };
}

module.exports = { extractClassStrings, collectClassText, isClassNameAttribute, createRawClassRule };
