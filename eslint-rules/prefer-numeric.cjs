/**
 * ESLint rule: prefer-numeric
 *
 * Flags `.toFixed(...)` / `.toLocaleString(...)` used to format a number for
 * DISPLAY (i.e. rendered inside JSX). The shared `<Numeric>` primitive gives
 * locale-aware formatting, precision, unit suffixes ($/%/ms/count/compact), and
 * guaranteed tabular figures in one place:
 *
 *   import { Numeric } from '@/features/shared/components/display/Numeric';
 *   <Numeric value={cost} unit="usd" />            // instead of {`$${cost.toFixed(2)}`}
 *   <Numeric value={pct} unit="percent" />          // instead of {pct.toFixed(1) + '%'}
 *
 * To avoid false positives on logic-context formatting (building an API string,
 * a key, a log line), this only fires when the call is inside a JSX expression
 * container. Warn-level: incremental fix-as-you-touch migration, like the other
 * `custom/no-raw-*` rules (see docs/refactor/shared-component-reuse.md §3).
 *
 * Allowed: the `<Numeric>` primitive itself and the canonical `lib/utils/formatters`
 * (where the single real toFixed/toLocaleString display formatting should live).
 *
 * Opt out for a justified one-off with:
 *   // eslint-disable-next-line custom/prefer-numeric
 */

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Use <Numeric> instead of raw .toFixed()/.toLocaleString() when displaying a number in JSX',
    },
    messages: {
      preferNumeric:
        'Avoid .{{method}}() for number display in JSX — use <Numeric value={…} unit precision> from ' +
        '@/features/shared/components/display/Numeric (locale-aware + unit suffixes + tabular figures). ' +
        'See docs/refactor/shared-component-reuse.md.',
    },
    schema: [],
  },
  create(context) {
    const filename = (
      typeof context.getFilename === 'function' ? context.getFilename() : context.filename
    ).replace(/\\/g, '/');

    // The shared primitive + canonical formatters legitimately own the call.
    if (/display\/Numeric\.tsx?$/.test(filename) || /\/lib\/utils\/formatters\./.test(filename)) return {};

    return {
      CallExpression(node) {
        const callee = node.callee;
        if (!callee || callee.type !== 'MemberExpression' || !callee.property) return;
        const method = callee.property.name;
        if (method !== 'toFixed' && method !== 'toLocaleString') return;

        // Skip DATES — <Numeric> formats numbers, not dates (use RelativeTime /
        // AbsoluteTime for those):
        //  - `new Date(...).toLocaleString()` / `.toFixed()` on a fresh Date
        const recv = callee.object;
        if (recv && recv.type === 'NewExpression' && recv.callee && recv.callee.name === 'Date') return;
        //  - `.toLocaleString(locale, { weekday/month/day/hour/… })` — date-format options
        if (method === 'toLocaleString' && node.arguments.length >= 2) {
          const opts = node.arguments[1];
          if (opts && opts.type === 'ObjectExpression') {
            const DATE_OPTS = new Set(['weekday', 'year', 'month', 'day', 'hour', 'minute', 'second', 'timeZone', 'timeZoneName', 'era', 'dayPeriod', 'dateStyle', 'timeStyle', 'hour12', 'calendar']);
            if (opts.properties.some((pr) => pr.key && DATE_OPTS.has(pr.key.name || pr.key.value))) return;
          }
        }

        // Must be DISPLAYED in JSX — and NOT handed to an inner function call. A
        // number passed to tx()/format()/String.replace() is string-building, not
        // a render site: a CallExpression ancestor before the JSX boundary → skip.
        let p = node.parent;
        let inJsx = false;
        while (p) {
          if (p.type === 'CallExpression') return;
          if (p.type === 'JSXExpressionContainer' || p.type === 'JSXElement' || p.type === 'JSXFragment') { inJsx = true; break; }
          p = p.parent;
        }
        if (!inJsx) return;

        context.report({ node, messageId: 'preferNumeric', data: { method } });
      },
    };
  },
};
