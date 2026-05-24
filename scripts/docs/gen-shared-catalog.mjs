#!/usr/bin/env node
/**
 * gen-shared-catalog.mjs — generates the shared-component catalog.
 *
 * Walks `src/features/shared/components/**` and emits a stable, grouped
 * markdown index at `src/features/shared/components/CATALOG.md`. The catalog
 * is the single discoverable answer to "does a shared component already exist
 * for this?" — referenced from CLAUDE.md so every session (and human) checks
 * it before hand-rolling UI.
 *
 * Description source per component (first match wins):
 *   1. a `@catalog <one-line>` JSDoc tag anywhere in the file (preferred),
 *   2. the first sentence of a leading `/** ... *\/` JSDoc block,
 *   3. the first `//` or `/* *\/` comment in the first ~12 lines,
 *   4. otherwise blank — which is a nudge to add a `@catalog` tag.
 *
 * No usage counts or other volatile data are emitted, so the committed file
 * only changes when components are added/removed/re-described — which keeps
 * the `--check` CI drift gate meaningful.
 *
 * Usage:
 *   node scripts/docs/gen-shared-catalog.mjs           # write CATALOG.md
 *   node scripts/docs/gen-shared-catalog.mjs --check    # exit 1 if stale (CI)
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(fileURLToPath(import.meta.url), '..', '..', '..');
const ROOT = join(repoRoot, 'src', 'features', 'shared', 'components');
const OUT = join(ROOT, 'CATALOG.md');

const SKIP = /(\.test\.|\.stories\.|__tests__|\/index\.tsx?$|FormErrorContext|AriaLiveProvider)/;

/** Recursively collect component source files under shared/components. */
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(full) && !SKIP.test(full.split(sep).join('/'))) out.push(full);
  }
  return out;
}

/**
 * Curated descriptions for the discoverability-critical primitives — the ones
 * most often hand-rolled. These take priority over source extraction so the
 * catalog is authoritative for the components that matter most. Components NOT
 * listed here fall back to a `@catalog` tag / export-adjacent JSDoc; add either
 * to improve their row.
 */
const CURATED = {
  Button: 'Canonical button — variants (primary/secondary/ghost/danger/accent), sizes, icons. Never style a raw <button>.',
  AsyncButton: 'Button that shows a spinner + disables itself while an async onClick is in flight.',
  CopyButton: 'Copy-to-clipboard button with built-in copied feedback. Use instead of raw navigator.clipboard.writeText.',
  LoadingSpinner: 'Canonical loading spinner with size + a11y label. Use for any full-element loading state.',
  ConfirmDialog: 'Confirm/cancel dialog for destructive or irreversible actions.',
  ErrorBanner: 'User-facing error display — inline / banner / panel variants with retry + dismiss.',
  SuspenseFallback: 'Standard fallback for React.lazy/Suspense boundaries.',
  Badge: 'Small labeled pill. Use for tags/counts; for status use StatusBadge/StatusDot.',
  StatusBadge: 'Status pill mapping a status token to label + color. Use with tokenLabel().',
  StatusDot: 'Minimal colored status dot for compact rows.',
  Tooltip: 'Hover/focus tooltip. Use instead of bare title= when you need styling/rich content.',
  TruncateWithTooltip: 'Truncates overflowing text and shows the full value in a Tooltip.',
  RelativeTime: 'Live-updating "2h ago" timestamp with absolute time on hover. Use for all timestamps.',
  Numeric: 'Canonical number/percent/count display — locale + precision + unit. Use instead of raw toFixed/toLocaleString.',
  AnimatedCounter: 'Number that animates from previous to new value.',
  Collapse: 'Pure-CSS animated expand/collapse container.',
  UnifiedTable: 'Standard data table (sorting/columns). Use instead of hand-built <table> grids.',
  InlineEditableText: 'Click-to-edit inline text field.',
  PersonaAvatar: 'Persona avatar (icon/color) rendering.',
  SectionLabel: 'Small uppercase section label.',
  FormField: 'Labeled form-field wrapper (label + hint + error) around any input.',
  Listbox: 'Accessible select/listbox dropdown. Use instead of raw <select> or custom dropdowns.',
  AccessibleToggle: 'Accessible on/off switch. Use instead of a raw checkbox styled as a toggle.',
  NumberStepper: 'Numeric input with +/- steppers.',
  ColorPicker: 'Color selection control.',
  PasswordToggleField: 'Password input with show/hide toggle.',
  KeyValueEditor: 'Editable list of key/value pairs.',
  BaseModal: 'Modal/dialog shell (backdrop, escape, focus trap, sizing). Use instead of hand-rolled fixed inset-0 overlays.',
  ContentLayout: 'Standard page content shell (max-width, padding, scroll).',
  SectionCard: 'Card with optional header/status-border/collapse. Use for grouped content panels.',
  SectionHeader: 'Section header (icon + title + badge + trailing actions).',
  PanelTabBar: 'Horizontal tab bar for in-panel navigation.',
  SegmentedTabs: 'Segmented control / pill tab switcher.',
  MarkdownRenderer: 'Safe markdown → React renderer (sanitized).',
  JsonEditor: 'JSON editing/validation editor.',
};

/** Pull a one-line description from a component source file. */
function describe(name, src) {
  if (CURATED[name]) return CURATED[name];

  const catalogTag = src.match(/@catalog\s+(.+)/);
  if (catalogTag) return clean(catalogTag[1]);

  // Prefer a JSDoc block immediately preceding the export of this component.
  const exportJsdoc = src.match(
    new RegExp(`\\/\\*\\*([\\s\\S]*?)\\*\\/\\s*\\n\\s*export\\s+(?:default\\s+)?(?:function|const|class)\\s+${name}\\b`)
  );
  if (exportJsdoc) {
    const first = exportJsdoc[1].replace(/^\s*\*/gm, ' ').match(/[A-Za-z`<].+?(?:\.|$)/);
    if (first) return clean(first[0]);
  }
  return '';
}

function clean(s) {
  return s
    .replace(/\*\//g, '')
    .replace(/[─\-=]{2,}/g, '')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 130);
}

/** Verify the filename-derived name is actually exported. */
function isExported(src, name) {
  const re = new RegExp(`export\\s+(?:default\\s+)?(?:function|const|class)\\s+${name}\\b|export\\s*\\{[^}]*\\b${name}\\b`);
  return re.test(src) || /export\s+default/.test(src);
}

const CATEGORY_BLURB = {
  buttons: 'Buttons & async/copy actions',
  display: 'Read-only display: badges, status, avatars, tables, time, numbers, tooltips',
  editors: 'Rich text / JSON / markdown / prompt editors & renderers',
  feedback: 'Loading, empty, error, confirm, toast — user feedback surfaces',
  forms: 'Inputs, toggles, selects, field wrappers, pickers',
  layout: 'Page/section structure, headers, tab bars, content shells',
  modals: 'Modal/dialog shells',
  overlays: 'Popovers, dropdowns, command palette, filter bars',
  picker: 'Specialized pickers',
  progress: 'Progress bars, steppers, skeletons',
  terminal: 'Terminal / streaming-output rendering',
  'use-cases': 'Use-case list/row/history domain components',
  icons: 'Icon helpers',
};

const files = walk(ROOT).sort();
const byCat = new Map();
for (const f of files) {
  const rel = relative(ROOT, f).split(sep).join('/');
  const cat = rel.includes('/') ? rel.split('/')[0] : '(root)';
  const name = rel.split('/').pop().replace(/\.tsx?$/, '');
  const src = readFileSync(f, 'utf8');
  if (!isExported(src, name)) continue;
  if (!byCat.has(cat)) byCat.set(cat, []);
  byCat.get(cat).push({ name, rel, desc: describe(name, src) });
}

const total = [...byCat.values()].reduce((n, a) => n + a.length, 0);
const undescribed = [...byCat.values()].flat().filter((c) => !c.desc).length;

let md = `<!-- GENERATED by scripts/docs/gen-shared-catalog.mjs — DO NOT EDIT BY HAND.
     Run \`npm run gen:catalog\` after adding/removing a shared component.
     Add a \`@catalog <one-line>\` JSDoc tag to a component to set its description here. -->

# Shared Component Catalog

**${total} reusable components** live under \`src/features/shared/components/\`.
**Check this list before building any UI** — import what exists; do not hand-roll
a spinner, empty state, button, modal, tooltip, badge, copy-button, relative-time
or number-format. Import as \`@/features/shared/components/<category>/<Name>\`.

> Also see [\`.claude/Design.md\`](../../../../.claude/Design.md) for tokens/typography
> and [\`docs/refactor/shared-component-reuse.md\`](../../../../docs/refactor/shared-component-reuse.md)
> for the "use X instead of hand-rolling Y" quick reference and migration backlog.

`;

for (const cat of [...byCat.keys()].sort()) {
  const items = byCat.get(cat).sort((a, b) => a.name.localeCompare(b.name));
  md += `## ${cat}${CATEGORY_BLURB[cat] ? ` — ${CATEGORY_BLURB[cat]}` : ''}\n\n`;
  md += `| Component | What it's for |\n|---|---|\n`;
  for (const c of items) md += `| \`${c.name}\` | ${c.desc || '_(add a `@catalog` tag)_'} |\n`;
  md += '\n';
}

md += `---\n_${total} components, ${undescribed} without a \`@catalog\` description._\n`;

if (process.argv.includes('--check')) {
  let current = '';
  try { current = readFileSync(OUT, 'utf8'); } catch { /* missing */ }
  if (current.trim() !== md.trim()) {
    console.error('CATALOG.md is stale — run `npm run gen:catalog` and commit the result.');
    process.exit(1);
  }
  console.log(`shared catalog up to date (${total} components).`);
} else {
  writeFileSync(OUT, md);
  console.log(`wrote ${relative(repoRoot, OUT)} (${total} components, ${undescribed} undescribed).`);
}
