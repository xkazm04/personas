#!/usr/bin/env node
/**
 * classify-shared.mjs — classify every component under
 * `src/features/shared/components/` as a PRIMITIVE, CHROME, or DOMAIN file, by
 * import coupling. Drives the catalog-curation move-manifest (Phase 0) and is
 * the same signal the generator/ESLint boundary enforces in Phase 1.
 *
 *   PRIMITIVE — imports only React / framer / lucide / @/lib/utils / @/i18n /
 *               design tokens / other @/features/shared/components. Stays in the catalog.
 *   CHROME    — app-shell / cross-cutting infra (reads global state but isn't one
 *               feature's domain). Explicit allow-list. Moves to src/features/shared/chrome/.
 *   DOMAIN    — couples to a feature via @/stores/<x>, @/api/<x>, @/lib/bindings/<T>,
 *               or @/features/<non-shared>. Moves back to the owning feature.
 *
 * A small KEEP_PRIMITIVE allow-list pins canonical primitives that today carry an
 * incidental store import (e.g. EmptyState→themeStore); these STAY but must shed
 * the coupling in Phase 1 (the --check guard / ESLint boundary will hold them to it).
 *
 * Usage:
 *   node scripts/refactor/classify-shared.mjs            # write the manifest
 *   node scripts/refactor/classify-shared.mjs --check    # exit 1 if any file under
 *                                                        # components/ still has a domain import
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(fileURLToPath(import.meta.url), '..', '..', '..');
const ROOT = join(repoRoot, 'src', 'features', 'shared', 'components');
const OUT = join(repoRoot, 'docs', 'refactor', 'catalog-curation.md');

const SKIP = /(\.test\.|\.stories\.|__tests__|\/index\.tsx?$|FormErrorContext|AriaLiveProvider)/;

// Imports that mark a file as DOMAIN-coupled. `@/features/shared` is explicitly
// NOT domain (it's the shared tree itself).
const DOMAIN_IMPORT = [
  /^@\/stores\//,
  /^@\/api\//,
  /^@\/lib\/bindings\//,
  /^@\/features\/(?!shared\b)/,
];

// CHROME allow-list — app-shell / infra that legitimately reads global state.
// Matched as a case-insensitive path substring. Takes precedence over DOMAIN.
// The whole `layout/sidebar/` and the desktop footer/titlebar family are the
// persistent app shell — they move together, not scattered per store import.
const CHROME = [
  'layout/sidebar/',
  'layout/TitleBar',
  'layout/useTitleBarTray',
  'layout/AuthButton',
  'layout/BreadcrumbTrail',
  'layout/DesktopFooter',
  'layout/SystemLoadFooterIcon',
  'layout/FleetActivityStrip',
  'layout/fleetStripModel',
  'layout/BackgroundServices',
  'feedback/ToastContainer',
  'feedback/notifications/NotificationCenter',
  'feedback/UpdateBanner',
  'overlays/CommandPalette',
  'overlays/commandPaletteUtils',
];

// Canonical primitives that today carry an INCIDENTAL domain import. They STAY in
// the catalog; Phase 1 decouples the import (prop / CSS var / callback) so the
// boundary rule passes. Listed in the manifest under "needs decoupling".
const KEEP_PRIMITIVE = [
  'feedback/EmptyState',          // themeStore → density/dominant-mode; pass as prop or CSS var
  'feedback/ErrorBoundary',       // systemStore → error report; use a callback / silentCatch
  'terminal/CliOutputPanel',      // settings/sub_engine engineCapabilities → pass operation as prop
  'terminal/TerminalStrip',       // settings/sub_engine engineCapabilities → pass operation as prop
  'overlays/ConfirmDestructiveModal', // BlastRadiusPanel/Item → accept a blastRadius?: ReactNode slot
];

// Curated DOMAIN destinations (path substring -> destination). First match wins;
// anything unmatched falls back to import-signal inference, else REVIEW.
const DEST_OVERRIDE = [
  ['layout/monitor/', 'features/fleet'],
  ['layout/radio/', 'features/plugins/radio'],
  ['editors/draft-editor/', 'features/templates'],
  ['use-cases/', 'features/agents/sub_lab'],
  ['layout/quick-answer/', 'features/agents'],
  ['forms/Persona', 'features/agents'],
  ['forms/SourceDefinitionInput', 'features/agents'],
  ['forms/DevToolsProjectDropdown', 'features/dev-tools'],
  ['forms/IconSelector', 'features/agents'],
  ['forms/PopupIconSelector', 'features/agents'],
  ['picker/Vault', 'features/vault'],
  ['picker/CredentialPickerCards', 'features/vault'],
  ['picker/AppearancePickers', 'features/settings'],
  ['display/SetupStatusBadge', 'features/vault'],
  ['display/BlastRadiusPanel', 'features/overview'],
  ['display/BusinessOutcomeBadge', 'features/overview'],
  ['display/PersonaIcon', 'features/agents'],
  ['display/PersonaAvatar', 'features/agents'],
  ['modals/ExecutionDetailModal', 'features/overview'],
  ['overlays/executionPlayer', 'features/agents'],
  ['progress/ConfigureStep', 'features/templates'],
  ['display/ConnectorMeta', 'REFACTOR — extract CONNECTOR_META → lib/connectors, keep pure <ConnectorIcon>'],
  ['display/CategoryChip', 'REFACTOR — make `source` optional (pure chip) or → features/agents'],
];

// Fallback destination inference from the offending import source.
const SIGNAL_DEST = [
  [/agentStore|@\/api\/agents/, 'features/agents'],
  [/vaultStore|@\/api\/(vault|credentials|discovery)/, 'features/vault'],
  [/@\/api\/templates|n8nTransform/, 'features/templates'],
  [/pipelineStore|@\/api\/pipeline|features\/teams/, 'features/pipeline'],
  [/themeStore|@\/api\/appearance/, 'features/settings'],
  [/overviewStore|@\/api\/(overview|execution|observability)/, 'features/overview'],
  [/@\/api\/devTools|DevProject/, 'features/dev-tools'],
  // Binding-type inference (shared types, but a strong domain hint) — checked last.
  [/bindings\/Persona(\b|[A-Z])/, 'features/agents'],
  [/bindings\/(Team|Goal|Recipe|Automation|Trigger)/, 'features/pipeline'],
  [/bindings\/(Credential|Connector|Vault|ImageGen)/, 'features/vault'],
  [/bindings\/(Execution|ManualReview|Alert|Health)/, 'features/overview'],
];

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(full) && !SKIP.test(full.split(sep).join('/'))) out.push(full);
  }
  return out;
}

function importsOf(src) {
  const out = [];
  const re = /(?:from|import)\s+['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src))) out.push(m[1]);
  return out;
}

function domainSignals(imports) {
  return [...new Set(imports.filter((i) => DOMAIN_IMPORT.some((re) => re.test(i))))];
}

function classify(rel, imports) {
  const lc = rel.toLowerCase();
  const signals = domainSignals(imports);
  if (KEEP_PRIMITIVE.some((p) => rel.includes(p))) return { cls: 'KEEP', signals };
  if (CHROME.some((c) => lc.includes(c.toLowerCase()))) return { cls: 'CHROME', signals };
  if (signals.length) return { cls: 'DOMAIN', signals };
  return { cls: 'PRIMITIVE', signals: [] };
}

function destFor(rel, signals) {
  const ov = DEST_OVERRIDE.find(([frag]) => rel.includes(frag));
  if (ov) return ov[1];
  for (const sig of signals) {
    const hit = SIGNAL_DEST.find(([re]) => re.test(sig));
    if (hit) return hit[1];
  }
  return 'REVIEW';
}

const rows = [];
for (const f of walk(ROOT).sort()) {
  const rel = relative(ROOT, f).split(sep).join('/');
  const src = readFileSync(f, 'utf8');
  const { cls, signals } = classify(rel, importsOf(src));
  rows.push({
    rel,
    cls,
    dest: cls === 'CHROME' ? 'features/shared/chrome' : cls === 'DOMAIN' ? destFor(rel, signals) : 'stays in components/',
    signals: signals.map((s) => s.replace(/^@\//, '')).join(', '),
  });
}

const counts = rows.reduce((a, r) => ((a[r.cls] = (a[r.cls] || 0) + 1), a), {});

if (process.argv.includes('--check')) {
  // Boundary guard: after Phase 1, NO file under components/ may carry a domain import.
  const offenders = rows.filter((r) => r.signals);
  if (offenders.length) {
    console.error(`FAIL: ${offenders.length} file(s) under shared/components/ still import a store/api/binding/feature:`);
    for (const r of offenders) console.error(`  ${r.rel}  [${r.signals}]  ${r.cls === 'KEEP' ? '(decouple — keep primitive)' : `→ ${r.dest}`}`);
    process.exit(1);
  }
  console.log(`OK: shared/components/ is domain-free (${counts.PRIMITIVE || 0} clean primitives).`);
  process.exit(0);
}

const section = (cls) =>
  rows
    .filter((r) => r.cls === cls)
    .map((r) => `| \`${r.rel}\` | ${r.dest} | ${r.signals || '—'} |`)
    .join('\n');

const md = `# Catalog curation — move-manifest (Phase 0)

> GENERATED by \`scripts/refactor/classify-shared.mjs\`. Re-run after edits.
> Reviewed source of truth for the Phase 1 relocation.

**${rows.length} files** under \`src/features/shared/components/\`:
**${counts.PRIMITIVE || 0} clean primitives** + **${counts.KEEP || 0} primitives-to-decouple** (stay) · **${counts.CHROME || 0} chrome** (→ \`shared/chrome/\`) · **${counts.DOMAIN || 0} domain** (→ owning feature).

## DOMAIN → owning feature (relocate)

| Component | Destination | Coupling signal |
|---|---|---|
${section('DOMAIN')}

## CHROME → \`src/features/shared/chrome/\` (shared, not catalogued)

| Component | Destination | Coupling signal |
|---|---|---|
${section('CHROME')}

## PRIMITIVE — stays in catalog but must DECOUPLE an incidental import (Phase 1)

| Component | Action | Coupling to remove |
|---|---|---|
${section('KEEP')}

---
_Clean primitives (${counts.PRIMITIVE || 0}) stay in \`shared/components/\` and remain the catalog. Not listed here._
`;

writeFileSync(OUT, md);
console.log(`wrote ${relative(repoRoot, OUT)} — ${rows.length} files: ${counts.PRIMITIVE || 0} primitive / ${counts.KEEP || 0} keep-decouple / ${counts.CHROME || 0} chrome / ${counts.DOMAIN || 0} domain`);
