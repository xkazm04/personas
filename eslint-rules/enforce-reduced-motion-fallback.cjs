/**
 * ESLint rule: enforce-reduced-motion-fallback
 *
 * Flags raw framer-motion `animate=` props that drive a *repeating* animation
 * (`transition: { repeat: ... }`) in a file that has no reduced-motion fallback.
 *
 * Why only repeating animations?
 *   The app wraps everything in `<MotionConfig reducedMotion="user">`, which
 *   already disables one-shot transform/layout animations when the OS requests
 *   reduced motion. What that global gate does NOT stop is a looping animation
 *   on a non-transform property (opacity pulses, color cycles, dash marches) —
 *   those keep cycling regardless of `prefers-reduced-motion` and are the real
 *   vestibular hazard (WCAG 2.3.3). So this rule targets the actual gap rather
 *   than every `animate=` prop (which would be thousands of false positives).
 *
 * How to satisfy the rule:
 *   - Wrap the variants with `useMotionVariants()` (preferred), or
 *   - Gate the `repeat`/`animate` behind `useReducedMotion()` /
 *     `useMotion().shouldAnimate`, or
 *   - For a one-off, add `// reduced-motion-ok: <reason>` on the line, or an
 *     `eslint-disable-next-line custom/enforce-reduced-motion-fallback`.
 *
 * A file "has a fallback" if it references any of: useReducedMotion, useMotion,
 * useMotionVariants, useTemplateMotion, toReducedVariants, prefersReducedMotion,
 * shouldAnimate. Files that do are trusted to handle the gate themselves.
 */

const FALLBACK_TOKENS = [
  "useReducedMotion",
  "useMotionVariants",
  "useMotion",
  "useTemplateMotion",
  "toReducedVariants",
  "prefersReducedMotion",
  "shouldAnimate",
];

/** True when `node` is a JSX element whose tag is `motion.X` or `m.X`. */
function isMotionElement(node) {
  const name = node.name;
  return (
    name &&
    name.type === "JSXMemberExpression" &&
    name.object.type === "JSXIdentifier" &&
    (name.object.name === "motion" || name.object.name === "m")
  );
}

/** Find a property by key name in an ObjectExpression. */
function getProp(objExpr, key) {
  if (!objExpr || objExpr.type !== "ObjectExpression") return null;
  return (
    objExpr.properties.find(
      (p) =>
        p.type === "Property" &&
        !p.computed &&
        ((p.key.type === "Identifier" && p.key.name === key) ||
          (p.key.type === "Literal" && p.key.value === key)),
    ) || null
  );
}

/**
 * Does this `transition` ObjectExpression request a repeat?
 * `repeat: Infinity`, `repeat: <n>` (n != 0), or any non-literal expression
 * (e.g. a variable) counts. `repeat: 0` does not.
 */
function transitionRepeats(transitionObj) {
  const repeatProp = getProp(transitionObj, "repeat");
  if (!repeatProp) return false;
  const v = repeatProp.value;
  if (v.type === "Literal" && (v.value === 0 || v.value === false)) return false;
  return true;
}

/** Unwrap a JSX attribute value to its ObjectExpression, if it is one. */
function attrObject(attr) {
  if (
    attr &&
    attr.value &&
    attr.value.type === "JSXExpressionContainer" &&
    attr.value.expression.type === "ObjectExpression"
  ) {
    return attr.value.expression;
  }
  return null;
}

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require a reduced-motion fallback for looping framer-motion animations.",
    },
    messages: {
      missingFallback:
        "Looping `animate` (transition.repeat) has no reduced-motion fallback. " +
        "A repeating animation keeps cycling even when the user sets prefers-reduced-motion " +
        "(the global <MotionConfig reducedMotion=\"user\"> only disables one-shot transforms). " +
        "Wrap the variants with useMotionVariants(), gate it behind useReducedMotion()/useMotion().shouldAnimate, " +
        "or add `// reduced-motion-ok: <reason>`. See WCAG 2.3.3.",
    },
    schema: [],
  },
  create(context) {
    const sourceCode = context.sourceCode || context.getSourceCode();
    // File-level trust: if the file already wires the motion system, skip it.
    const fileText = sourceCode.getText();
    const fileHasFallback = FALLBACK_TOKENS.some((tok) => fileText.includes(tok));
    if (fileHasFallback) return {};

    function hasInlineOptOut(node) {
      const comments = sourceCode.getAllComments();
      const line = node.loc.start.line;
      return comments.some(
        (c) =>
          /reduced-motion-ok/.test(c.value) &&
          c.loc.start.line >= line - 1 &&
          c.loc.start.line <= node.loc.end.line,
      );
    }

    return {
      JSXOpeningElement(node) {
        if (!isMotionElement(node)) return;

        const attrs = node.attributes.filter((a) => a.type === "JSXAttribute");
        const animateAttr = attrs.find((a) => a.name.name === "animate");
        if (!animateAttr) return;

        // Repeat can live in a sibling `transition=` attribute or nested in the
        // `animate` object's own `transition` key.
        let repeats = false;

        const transitionAttr = attrs.find((a) => a.name.name === "transition");
        const transitionObj = attrObject(transitionAttr);
        if (transitionObj && transitionRepeats(transitionObj)) repeats = true;

        if (!repeats) {
          const animateObj = attrObject(animateAttr);
          if (animateObj) {
            const nestedTransition = getProp(animateObj, "transition");
            if (
              nestedTransition &&
              nestedTransition.value.type === "ObjectExpression" &&
              transitionRepeats(nestedTransition.value)
            ) {
              repeats = true;
            }
          }
        }

        if (!repeats) return;
        if (hasInlineOptOut(node)) return;

        context.report({ node: animateAttr, messageId: "missingFallback" });
      },
    };
  },
};
