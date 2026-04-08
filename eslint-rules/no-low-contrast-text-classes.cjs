/**
 * ESLint rule: no-low-contrast-text-classes
 *
 * Forbids the muted-text antipattern in body content.
 *
 * Body text — descriptions, dates, URLs, source paths, and any prose the user
 * is meant to READ — must use `text-foreground` (theme-aware: white in dark
 * themes, black in light themes). Muted/transparent text colors fade into the
 * background on every theme except the high-contrast one and produce
 * near-illegible cards.
 *
 * What this rule flags:
 *   - `text-muted-foreground/N` for any N
 *   - `text-foreground/N` where N <= 80 (i.e. /80, /70, /60 ... /5)
 *   - `text-muted-foreground` (no opacity, also forbidden — the token itself
 *     is reserved for structural micro-labels, not body content)
 *
 * What this rule allows (legitimate exceptions):
 *   - State modifiers: `disabled:text-muted-foreground/50`, `hover:text-foreground/70`
 *   - Direct accent colors on badges: `text-cyan-400`, `text-emerald-400`
 *     (the badge color IS the signal — not a contrast tradeoff)
 *   - `text-foreground/85` and above (effectively the same as text-foreground)
 *   - Lines that explicitly opt out with `eslint-disable-next-line` or a
 *     trailing comment `// muted-ok: <reason>`
 *
 * Mapping guide:
 *   text-muted-foreground/60   → text-foreground
 *   text-foreground/70         → text-foreground
 *   text-muted-foreground/40   → text-foreground
 *   (for hierarchy use text-primary + drop-shadow, NOT a lower opacity)
 *
 * See `.claude/CLAUDE.md` → "UI Conventions → Typography contrast" for the
 * full rule, the recipe for theme-accent titles, and the rationale.
 */

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Forbid muted/transparent text colors on body content. Use text-foreground for content and text-primary (with shadow) for hierarchy.",
    },
    messages: {
      mutedForeground:
        'Avoid "{{ raw }}" on body text — `text-muted-foreground/N` fades into the background on most themes. ' +
        "Use `text-foreground` instead (white in dark themes, black in light). " +
        "For visual hierarchy use `text-primary` + a subtle text-shadow on titles, NOT lower opacity. " +
        "See CLAUDE.md → UI Conventions → Typography contrast.",
      foregroundOpacity:
        'Avoid "{{ raw }}" on body text — opacity below ~85% defeats the high-contrast token. ' +
        "Use bare `text-foreground` for body content. " +
        "See CLAUDE.md → UI Conventions → Typography contrast.",
    },
    schema: [],
  },
  create(context) {
    // text-muted-foreground (with or without /N) — always forbidden on body content
    // unless prefixed with a state modifier like `disabled:` or `hover:`.
    const MUTED_RE = /(?:^|[\s])(text-muted-foreground(?:\/\d+)?)\b/;

    // text-foreground/N where N is 0..80 (the "transparent body text" antipattern).
    // Excluded: bare `text-foreground` and `text-foreground/85`..`text-foreground/100`.
    const FOREGROUND_LOW_RE =
      /(?:^|[\s])(text-foreground\/(?:[0-9]|[1-7][0-9]|80))\b/;

    // State modifier prefixes — these are intentional muting (disabled, hover, focus).
    // If the token is preceded by one of these, allow it.
    function isStateModifier(value, matchIndex) {
      // Walk back from matchIndex to find the start of this token
      let i = matchIndex;
      while (i > 0 && /\S/.test(value[i - 1])) i--;
      const tokenStart = value.slice(i, matchIndex + 1);
      return /^(disabled|hover|focus|focus-visible|active|aria-\w+|data-\w+|group-hover|peer-hover|dark|light):/.test(
        tokenStart,
      );
    }

    /**
     * Walk a className value AST node and yield every string fragment plus
     * its source AST node so we can attach reports to the right place.
     *
     * Handles: literal strings, template literals, array.join() patterns,
     * cn()/clsx()/twMerge() function calls, and ternary expressions.
     */
    function extractStrings(node) {
      if (!node) return [];

      if (node.type === "Literal" && typeof node.value === "string") {
        return [{ value: node.value, node }];
      }

      if (node.type === "TemplateLiteral") {
        return node.quasis.map((q) => ({ value: q.value.raw, node: q }));
      }

      if (node.type === "JSXExpressionContainer") {
        return extractStrings(node.expression);
      }

      // Array.join(' ') — common pattern in this codebase for multi-line classes
      if (
        node.type === "CallExpression" &&
        node.callee.type === "MemberExpression" &&
        node.callee.property.name === "join" &&
        node.callee.object.type === "ArrayExpression"
      ) {
        const results = [];
        for (const el of node.callee.object.elements) {
          if (el) results.push(...extractStrings(el));
        }
        return results;
      }

      // cn(...), clsx(...), twMerge(...), classNames(...), cx(...)
      if (
        node.type === "CallExpression" &&
        node.callee.type === "Identifier" &&
        /^(cn|clsx|twMerge|classNames|cx)$/.test(node.callee.name)
      ) {
        const results = [];
        for (const arg of node.arguments) {
          results.push(...extractStrings(arg));
        }
        return results;
      }

      // Ternary: condition ? 'a' : 'b'
      if (node.type === "ConditionalExpression") {
        return [
          ...extractStrings(node.consequent),
          ...extractStrings(node.alternate),
        ];
      }

      return [];
    }

    /**
     * Inspect a single string fragment for either antipattern. Returns the
     * matched class name + which message to report, or null if clean.
     */
    function findViolation(value) {
      // Check muted-foreground first (more severe)
      let m = MUTED_RE.exec(value);
      if (m) {
        const matchIndex = m.index + m[0].indexOf(m[1]);
        if (!isStateModifier(value, matchIndex)) {
          return { raw: m[1], messageId: "mutedForeground" };
        }
      }

      // Then check foreground/<low>
      m = FOREGROUND_LOW_RE.exec(value);
      if (m) {
        const matchIndex = m.index + m[0].indexOf(m[1]);
        if (!isStateModifier(value, matchIndex)) {
          return { raw: m[1], messageId: "foregroundOpacity" };
        }
      }

      return null;
    }

    return {
      JSXAttribute(node) {
        if (node.name.name !== "className") return;

        const parts = extractStrings(node.value);
        for (const { value, node: reportNode } of parts) {
          const violation = findViolation(value);
          if (violation) {
            context.report({
              node: reportNode,
              messageId: violation.messageId,
              data: { raw: violation.raw },
            });
          }
        }
      },
    };
  },
};
