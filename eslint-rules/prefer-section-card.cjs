/**
 * ESLint rule: prefer-section-card
 *
 * Flags a `<div>` that hand-rolls `<SectionCard>`'s exact shell signature
 * (`bg-secondary/30` + `border border-primary/12` + `shadow-elevation-1`) — i.e.
 * a literal reimplementation of the shared layout primitive:
 *
 *   import { SectionCard } from '@/features/shared/components/layout/SectionCard';
 *   <SectionCard title="…" action={…}>…</SectionCard>
 *
 * Precision: it requires BOTH distinctive shell classes (`bg-secondary/30` AND
 * `border-primary/12`) at their canonical opacities. This is deliberately narrow.
 * A "card-ish" div with DIFFERENT styling (bg-card-bg, border-border, other radii)
 * is NOT flagged — migrating that to SectionCard would CHANGE its appearance, which
 * is a visual redesign, not a faithful refactor. Only genuine shell reimplementations
 * (a faithful swap, no visual change) are flagged. Warn-level. See
 * docs/refactor/shared-component-reuse.md.
 *
 * Allowed: the SectionCard primitive itself.
 *
 * Opt out: // eslint-disable-next-line custom/prefer-section-card
 */

function shellPresent(cls) {
  return cls.includes('bg-secondary/30') && cls.includes('border-primary/12');
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
    else if (n.type === 'CallExpression') n.arguments.forEach(visit);
  };
  visit(valueNode.expression);
  return out.join(' ');
}

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: 'suggestion',
    docs: { description: 'Use <SectionCard> instead of hand-rolling its shell (bg-secondary/30 + border-primary/12 + shadow-elevation-1)' },
    messages: {
      preferCard:
        'This <div> hand-rolls the SectionCard shell (bg-secondary/30 + border-primary/12) — use ' +
        '<SectionCard> from @/features/shared/components/layout/SectionCard (title/icon/action header, ' +
        'sizes, optional collapsible + status accent). See docs/refactor/shared-component-reuse.md.',
    },
    schema: [],
  },
  create(context) {
    const filename = (
      typeof context.getFilename === 'function' ? context.getFilename() : context.filename
    ).replace(/\\/g, '/');
    if (/layout\/SectionCard\.tsx?$/.test(filename)) return {};

    return {
      JSXOpeningElement(node) {
        if (!node.name || node.name.name !== 'div') return;
        const attr = node.attributes.find(
          (a) => a.type === 'JSXAttribute' && a.name && a.name.name === 'className',
        );
        if (!attr) return;
        const cls = classText(attr.value);
        if (!cls || !shellPresent(cls)) return;
        context.report({ node, messageId: 'preferCard' });
      },
    };
  },
};
