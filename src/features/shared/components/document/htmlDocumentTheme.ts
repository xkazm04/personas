/**
 * The theme bridge for `HtmlDocumentFrame`: the app's live colours and fonts,
 * RESOLVED to values, offered to an agent-authored document as `--pa-*`
 * custom properties it MAY use (`color: var(--pa-foreground)`).
 *
 * Resolved, not copied: several app tokens are themselves `color-mix()` over
 * other tokens, and a `var()` reference means nothing inside the frame's own
 * document. A probe element in the host document lets the browser compute
 * each token to a concrete value.
 *
 * The only rules the bridge adds are on `:where(html)` - zero specificity and
 * first in the cascade - so a document's own styles always win. They exist so
 * an UNSTYLED fragment reads in the app's type and ink instead of the UA's
 * black Times on a dark reader, and so the frame shares the host's
 * `color-scheme` (a mismatch makes the browser paint an opaque canvas behind
 * the document).
 */

const COLOR_TOKENS = [
  'foreground',
  'background',
  'primary',
  'accent',
  'secondary',
  'muted-foreground',
  'border',
] as const;

const FONT_TOKENS = ['sans', 'mono'] as const;

export function themeBridgeCss(): string {
  if (typeof document === 'undefined' || !document.body) return '';
  const probe = document.createElement('span');
  probe.style.position = 'absolute';
  probe.style.visibility = 'hidden';
  document.body.appendChild(probe);
  const decls: string[] = [];
  try {
    for (const token of COLOR_TOKENS) {
      probe.style.color = `var(--${token})`;
      const value = getComputedStyle(probe).color;
      if (value) decls.push(`--pa-${token}: ${value};`);
    }
    for (const token of FONT_TOKENS) {
      probe.style.fontFamily = `var(--font-${token})`;
      const value = getComputedStyle(probe).fontFamily;
      if (value) decls.push(`--pa-font-${token}: ${value};`);
    }
  } finally {
    probe.remove();
  }
  const scheme = getComputedStyle(document.documentElement).colorScheme || 'normal';
  return [
    `:root { ${decls.join(' ')} }`,
    `:where(html) { color-scheme: ${scheme}; color: var(--pa-foreground); font-family: var(--pa-font-sans); line-height: 1.6; }`,
    ':where(body) { margin: 0; }',
    ':where(img, video, svg) { max-width: 100%; height: auto; }',
  ].join('\n');
}
