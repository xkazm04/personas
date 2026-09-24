#!/usr/bin/env node
// measure.mjs - the counts behind docs/design/style-mastery/migration-map.md.
//
// Run from the repo root:  node docs/design/style-mastery/specimen/measure.mjs
// Writes measure.generated.json (counts) and pairs.generated.json (the
// token + utility co-occurrences the Chromium probe classifies as dead or live).
//
// UNIT OF ANALYSIS: one quoted string (", ' or a template literal's static
// text) on one line of a .ts/.tsx file under src/. That is the same unit the
// census rule `typo-token-overpainted` uses ("inside one class string"). A
// token and a utility split across two cn() arguments are NOT paired, so every
// pair count here is a lower bound. Comment lines are skipped.
//
// Nothing here is imported by the app.

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..', '..');
const SRC = join(ROOT, 'src');

// -- the token inventory, read from the shipped stylesheet -------------------
const typoCss = readFileSync(join(SRC, 'styles', 'typography.css'), 'utf8');
const DEFINED = new Set([...typoCss.matchAll(/\.(typo-[a-z0-9-]+)/g)].map((m) => m[1]));
// Modifiers, not tiers: they set one property and are not a type role.
const MODIFIERS = new Set(['typo-rtl', 'typo-hero-shine', 'typo-weight-light']);
const TIERS = [...DEFINED].filter((t) => !MODIFIERS.has(t)).sort();

// Which properties each tier sets UNLAYERED (so a layered utility for the same
// property loses today). Parsed from the base rule of each tier.
function ruleBody(name) {
  const m = typoCss.match(new RegExp(`\\n\\.${name}\\s*\\{([^}]*)\\}`));
  return m ? m[1] : '';
}
const TIER_PROPS = Object.fromEntries(TIERS.map((t) => {
  const body = ruleBody(t);
  return [t, {
    size: /font-size/.test(body), weight: /font-weight/.test(body), leading: /line-height/.test(body),
    tracking: /letter-spacing/.test(body), colour: /(^|[\s;])color\s*:/.test(body),
    family: /font-family/.test(body), numeric: /font-variant-numeric/.test(body),
  }];
}));

// Names that are not typo tiers even though they start with typo- (ids in a
// harness scenario file, census rule names quoted in comments).
const NOT_CLASSES = /^typo-(mapping|agents-core|agents-sub|triggers|remaining|templates|shared|settings|plugins|overview|home|token-overpainted)$/;

// -- walk ---------------------------------------------------------------------
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) { if (name !== 'node_modules') walk(p, out); }
    else if (/\.(ts|tsx)$/.test(name) && !/\.d\.ts$/.test(name)) out.push(p);
  }
  return out;
}
const files = walk(SRC);

const HUES = 'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';
const PALETTE_RE = new RegExp(`^(text|bg|border|ring|from|to|via|fill|stroke|shadow|outline|divide|decoration|accent|placeholder|caret)-(${HUES})-(\\d{2,3})(/.*)?$`);
const SIZE_RE = /^text-(xs|sm|md|base|lg|xl|[2-9]xl|\[[\d.]+(px|rem|em)\])$/;
const WEIGHT_RE = /^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/;
const LEADING_RE = /^leading-/;
const TRACKING_RE = /^tracking-/;
const FAMILY_RE = /^font-(mono|sans|serif)$/;
const NUMERIC_RE = /^(tabular-nums|lining-nums|oldstyle-nums|proportional-nums)$/;
const TEXT_NOT_COLOUR = /^text-(left|center|right|justify|start|end|wrap|nowrap|balance|pretty|ellipsis|clip)$/;

/** Split one class token into { base, variant, important }. */
function parseToken(tok) {
  let depth = 0; let cut = -1;
  for (let i = 0; i < tok.length; i++) {
    const c = tok[i];
    if (c === '[') depth++; else if (c === ']') depth--; else if (c === ':' && depth === 0) cut = i;
  }
  let base = cut >= 0 ? tok.slice(cut + 1) : tok;
  const variant = cut >= 0 ? tok.slice(0, cut) : '';
  let important = false;
  if (base.startsWith('!')) { important = true; base = base.slice(1); }
  if (base.endsWith('!')) { important = true; base = base.slice(0, -1); }
  return { base, variant, important };
}

function family(base) {
  if (SIZE_RE.test(base)) return 'size';
  if (WEIGHT_RE.test(base)) return 'weight';
  if (LEADING_RE.test(base)) return 'leading';
  if (TRACKING_RE.test(base)) return 'tracking';
  if (FAMILY_RE.test(base)) return 'family';
  if (NUMERIC_RE.test(base)) return 'numeric';
  if (base.startsWith('text-') && !TEXT_NOT_COLOUR.test(base)) return 'colour';
  return null;
}

const counts = {
  scope: 'src/**/*.{ts,tsx} (d.ts excluded), one quoted string per unit',
  files: files.length,
  tokens: {}, tokenFiles: {}, arbitraryVariantTypo: 0, arbitraryVariantTypoSites: [],
  phantoms: {}, phantomFiles: {},
  muting: { fgSlash: {}, fgSlashTotal: 0, fgOpacityUnits: 0, fgOpacityByN: {}, mutedForeground: {}, textMuted: 0, textMutedDark: 0, caption: 0 },
  palette: { byPrefix: {}, byStep: {}, byHue: {}, statusText: 0, statusAny: 0 },
  accentColor: {}, contentTone: {},
};
const pairs = new Map(); // key token|utility -> { token, utility, family, sites: [] }
const recolourSites = {}; // colour-owning token with no sibling colour class

const inc = (o, k, n = 1) => { o[k] = (o[k] ?? 0) + n; };
// Button.tsx AccentColor; a literal inside accentColor={...} that is not one
// of these is a comparison operand (testStatus === 'passed'), not a colour.
const ACCENT_NAMES = new Set(['cyan', 'purple', 'violet', 'emerald', 'amber', 'blue', 'rose', 'sky', 'teal', 'indigo', 'orange', 'pink', 'lime']);

for (const file of files) {
  const rel = relative(ROOT, file).replace(/\\/g, '/');
  const text = readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);
  const fileTokens = new Set();
  const filePhantoms = new Set();

  // Button accentColor values (literal, or literals inside an expression).
  for (const m of text.matchAll(/accentColor\s*=\s*(?:"([a-z]+)"|\{([^}]*)\})/g)) {
    if (m[1]) inc(counts.accentColor, m[1]);
    else for (const lit of m[2].matchAll(/'([a-z]+)'|"([a-z]+)"/g)) inc(counts.accentColor, lit[1] ?? lit[2]);
  }
  for (const m of text.matchAll(/<Content(?:Card|Pill|Bullets)\b[^>]*?\btone=(?:"([a-z]+)"|\{'([a-z]+)'\})/g)) inc(counts.contentTone, m[1] ?? m[2]);
  for (const m of text.matchAll(/CONTENT_TONES\.([a-z]+)/g)) inc(counts.contentTone, `CONTENT_TONES.${m[1]}`);
  for (const m of text.matchAll(/toneOf\(attrs\.tone, '([a-z]+)'\)/g)) inc(counts.contentTone, `markdown default ${m[1]}`);

  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
    const units = [];
    for (const m of line.matchAll(/"([^"]*)"|'([^']*)'|`([^`]*)`/g)) {
      const raw = m[1] ?? m[2] ?? m[3] ?? '';
      units.push(raw.replace(/\$\{[^}]*\}/g, ' '));
    }
    for (const unit of units) {
      const toks = unit.split(/\s+/).filter(Boolean);
      if (!toks.length) continue;
      const parsed = toks.map(parseToken);
      const typoHere = [];
      let hasFg = false; let colourSibling = false;
      for (const p of parsed) {
        const { base, variant, important } = p;
        if (/^typo-[a-z0-9-]+$/.test(base) && !NOT_CLASSES.test(base)) {
          if (variant.startsWith('[')) { counts.arbitraryVariantTypo++; counts.arbitraryVariantTypoSites.push(`${rel}:${i + 1} ${variant}:${base}`); continue; }
          if (DEFINED.has(base)) { inc(counts.tokens, base); fileTokens.add(base); if (!variant && TIER_PROPS[base]) typoHere.push(base); }
          else { inc(counts.phantoms, base); filePhantoms.add(base); }
        }
        if (base === 'text-foreground' && !variant) hasFg = true;
        let fm = base.match(/^text-foreground\/(\d+|\[[^\]]+\])$/);
        if (fm) { inc(counts.muting.fgSlash, fm[1]); counts.muting.fgSlashTotal++; }
        fm = base.match(/^text-muted-foreground(\/\d+)?$/);
        if (fm) inc(counts.muting.mutedForeground, fm[1] ?? '(solid)');
        if (base === 'text-muted') counts.muting.textMuted++;
        if (base === 'text-muted-dark') counts.muting.textMutedDark++;
        if (base === 'typo-caption' && !variant) counts.muting.caption++;
        const pm = base.match(PALETTE_RE);
        if (pm) {
          inc(counts.palette.byPrefix, pm[1]);
          inc(counts.palette.byHue, pm[2]);
          if (['text', 'bg', 'border'].includes(pm[1])) inc(counts.palette.byStep, `${pm[1]}-${pm[2]}-${pm[3]}`);
        }
        if (/^text-status-/.test(base)) counts.palette.statusText++;
        if (/^(text|bg|border|ring|fill|stroke)-status-/.test(base)) counts.palette.statusAny++;
        if (family(base) === 'colour' && !important) colourSibling = true;
        void important;
      }
      if (hasFg) {
        const op = parsed.find((p) => !p.variant && /^opacity-\d+$/.test(p.base));
        if (op) { counts.muting.fgOpacityUnits++; inc(counts.muting.fgOpacityByN, op.base.slice(8)); }
      }
      // pairs: a utility beside a defined tier token in the same unit
      for (const token of typoHere) {
        const props = TIER_PROPS[token];
        if (props.colour && !colourSibling) (recolourSites[token] ??= []).push(`${rel}:${i + 1}`);
        for (const p of parsed) {
          const fam = family(p.base);
          if (!fam) continue;
          const key = `${token}|${p.base}`;
          const e = pairs.get(key) ?? { token, utility: p.base, family: fam, tokenSetsIt: !!props[fam], sites: [], importantSites: 0, variantSites: 0 };
          if (p.important) e.importantSites++;
          else { e.sites.push(`${rel}:${i + 1}`); if (p.variant) e.variantSites++; }
          pairs.set(key, e);
        }
      }
    }
  });
  for (const t of fileTokens) inc(counts.tokenFiles, t);
  for (const t of filePhantoms) inc(counts.phantomFiles, t);
}

counts.tierProps = TIER_PROPS;
counts.recolour = Object.fromEntries(Object.entries(recolourSites).map(([k, v]) => [k, v.length]));
counts.palette.byStepTop = Object.entries(counts.palette.byStep).sort((a, b) => b[1] - a[1]).slice(0, 30);
counts.accentColor = Object.fromEntries(Object.entries(counts.accentColor).filter(([k]) => ACCENT_NAMES.has(k)));
counts.palette.totals = {
  text: counts.palette.byPrefix.text ?? 0, bg: counts.palette.byPrefix.bg ?? 0, border: counts.palette.byPrefix.border ?? 0,
};
delete counts.palette.byStep;

// Site lists are kept only where the token sets the property (the codemod's
// candidates); for the rest the count is enough and the file stays small.
const pairList = [...pairs.values()].sort((a, b) => b.sites.length - a.sites.length)
  .map((p) => ({ ...p, siteCount: p.sites.length, sites: p.tokenSetsIt ? p.sites : [] }));
writeFileSync(join(HERE, 'measure.generated.json'), JSON.stringify(counts, null, 1) + '\n');
writeFileSync(join(HERE, 'pairs.generated.json'), '[\n' + pairList.map((p) => JSON.stringify(p)).join(',\n') + '\n]\n');
console.log(`files ${files.length}; tiers ${TIERS.length}; phantoms ${Object.keys(counts.phantoms).length}; pairs ${pairList.length}; pair sites ${pairList.reduce((s, p) => s + p.siteCount, 0)}`);
