/**
 * ESLint rule: prefer-status-badge
 *
 * Flags a `<span>` / `<div>` that hand-rolls one of `<StatusBadge>`'s exact
 * variant/accent color combos (`bg-{c}-500/10` + `text-{c}-400` + `border-{c}-500/20`).
 * Such an element is literally re-implementing the shared primitive:
 *
 *   import { StatusBadge } from '@/features/shared/components/display/StatusBadge';
 *   <StatusBadge variant="success">Active</StatusBadge>      // emerald combo
 *   <StatusBadge accent="violet">Beta</StatusBadge>           // violet combo
 *
 * Precision: it requires the COMPLETE three-class combo at the canonical opacities,
 * so near-matches (a count badge at `/15`, a code tag at `/12`, `text-…-400/80`,
 * or a panel missing the border) are intentionally NOT flagged — those are judgment
 * calls, not clean StatusBadge reimplementations. Warn-level (incremental, like the
 * other custom adoption rules). See docs/refactor/shared-component-reuse.md.
 *
 * Allowed: the StatusBadge primitive itself.
 *
 * Opt out: // eslint-disable-next-line custom/prefer-status-badge
 */

// Semantic variants (color → StatusBadge variant). Checked first so emerald maps
// to `variant="success"`, not `accent="emerald"`.
const VARIANT_BY_COLOR = { emerald: 'success', amber: 'warning', red: 'error', blue: 'info' };
// Arbitrary accent colors (those not already a semantic variant).
const ACCENT_COLORS = ['cyan', 'purple', 'violet', 'rose', 'sky', 'teal', 'indigo', 'orange', 'pink', 'lime'];

function comboPresent(cls, c) {
  return (
    cls.includes(`bg-${c}-500/10`) &&
    new RegExp(`text-${c}-400(?![\\w/])`).test(cls) &&
    cls.includes(`border-${c}-500/20`)
  );
}

/** Collect the static className text from a className attribute value. */
function classText(valueNode) {
  if (!valueNode) return '';
  if (valueNode.type === 'Literal') return String(valueNode.value || '');
  if (valueNode.type !== 'JSXExpressionContainer') return '';
  const out = [];
  const visit = (n) => {
    if (!n) return;
    if (n.type === 'Literal') out.push(String(n.value || ''));
    else if (n.type === 'TemplateLiteral') n.quasis.forEach((q) => out.push(q.value.raw));
    else if (n.type === 'ConditionalExpression') { visit(n.consequent); visit(n.alternate); }
    else if (n.type === 'LogicalExpression') { visit(n.left); visit(n.right); }
    else if (n.type === 'CallExpression') n.arguments.forEach(visit); // cn(...) / clsx(...)
  };
  visit(valueNode.expression);
  return out.join(' ');
}

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: 'suggestion',
    docs: { description: 'Use <StatusBadge> instead of hand-rolling its variant/accent color combo' },
    messages: {
      preferBadge:
        'This element hand-rolls the StatusBadge {{kind}} "{{name}}" color combo — use ' +
        '<StatusBadge {{kind}}="{{name}}"> from @/features/shared/components/display/StatusBadge ' +
        '(consistent size/shape/icon slot). See docs/refactor/shared-component-reuse.md.',
    },
    schema: [],
  },
  create(context) {
    const filename = (
      typeof context.getFilename === 'function' ? context.getFilename() : context.filename
    ).replace(/\\/g, '/');
    if (/display\/StatusBadge\.tsx?$/.test(filename)) return {};

    return {
      JSXOpeningElement(node) {
        const tag = node.name && node.name.name;
        if (tag !== 'span' && tag !== 'div') return;
        const attr = node.attributes.find(
          (a) => a.type === 'JSXAttribute' && a.name && a.name.name === 'className',
        );
        if (!attr) return;
        const cls = classText(attr.value);
        if (!cls) return;

        for (const [color, variant] of Object.entries(VARIANT_BY_COLOR)) {
          if (comboPresent(cls, color)) {
            context.report({ node, messageId: 'preferBadge', data: { kind: 'variant', name: variant } });
            return;
          }
        }
        for (const color of ACCENT_COLORS) {
          if (comboPresent(cls, color)) {
            context.report({ node, messageId: 'preferBadge', data: { kind: 'accent', name: color } });
            return;
          }
        }
      },
    };
  },
};
