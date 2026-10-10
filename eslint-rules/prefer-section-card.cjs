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

const { collectClassText, isClassNameAttribute } = require('./_classname-strings.cjs');

function shellPresent(cls) {
  return cls.includes('bg-secondary/30') && cls.includes('border-primary/12');
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
        const attr = node.attributes.find((a) => a.type === 'JSXAttribute' && isClassNameAttribute(a));
        if (!attr) return;
        const cls = collectClassText(attr.value);
        if (!cls || !shellPresent(cls)) return;
        context.report({ node, messageId: 'preferCard' });
      },
    };
  },
};
