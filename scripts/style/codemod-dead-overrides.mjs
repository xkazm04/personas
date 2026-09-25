#!/usr/bin/env node
/**
 * codemod-dead-overrides: delete type utilities that a typo-* token already
 * overrides, and only those, proven per case in Chromium.
 *
 * WHY. typography.css was unlayered, so its rules beat every Tailwind utility
 * (a cascade layer) written beside a token: `typo-body font-medium` renders 400.
 * Such a utility is DEAD: it changes nothing today. The D6 order deletes the dead
 * ones BEFORE typography.css moves into a layer, because a layered token loses to
 * a utility and every dead utility would then wake up at once. After the move the
 * same tool still earns its keep: a utility whose value equals the token's (for
 * example `typo-code font-mono`) is dead in the same sense, and new debt of that
 * shape is what the fleet phase re-runs it on.
 *
 * WHAT "DEAD" MEANS HERE, measured and not inferred from a regex: for a case
 * (token set T, utility U), scripts/style/dead-override-probe renders T and T+U
 * against the app's real globals.css in every theme x text-scale context and
 * compares ten computed type properties. U is deleted only when T+U equals T in
 * EVERY context and U moves at least one of those properties on a neutral host
 * (so a non-type class is never "dead"). A utility that an unlayered text-scale
 * rule or a light-theme repair rule lets win in one context is live and kept.
 *
 * TOKENS are read from src/styles/typography.css (every `.typo-*` selector);
 * the modifiers typo-rtl and typo-hero-shine never govern a deletion.
 *
 * SYNTACTIC POSITIONS (the unit is a class string):
 *   handled   a string or no-substitution template literal; the static text of a
 *             template literal (a token touching `${` is partial and ignored);
 *             inside a JSX className/class attribute, a token in an UNCONDITIONAL
 *             piece (the attribute string, a template's static text, an array
 *             joined with .join(' '), a `+` concatenation) governs utilities in
 *             every piece of the same attribute, conditional ones included;
 *             constant maps and any other string holding a token + utility.
 *   not handled (counted in the report, never edited): a utility whose only
 *             token sits in a conditional piece or behind an identifier, a
 *             className prop passed through a component, object-literal keys,
 *             arbitrary variants (`[&_h1]:`), pseudo-element variants, important
 *             utilities, escaped literals, and test files.
 * Element-state variants (hover:, md:, group-hover:, data-[..]:, ...) are
 * deleted when their base utility is dead in every context: a variant emits the
 * base's declarations in the same layer under a narrower selector, and loses to
 * the same token for the same reason.
 *
 * Usage (from the repo root):
 *   node scripts/style/codemod-dead-overrides.mjs                 dry run, writes the report
 *   node scripts/style/codemod-dead-overrides.mjs --apply         edit files (skips dirty ones)
 *   node scripts/style/codemod-dead-overrides.mjs --verify <baseline.json>
 *        re-render every case of a previous run on today's CSS and compare what each
 *        SITE renders now (T if its utility was deleted, T+U if kept) with the baseline
 *   --out <dir>   report dir (default tmp/style-codemod)   --port <n> (default 1433)
 *   --scales a,b  (default: themeStore's TextScale union, the scales a user can pick)
 *   --majority    also delete a PARTLY live case (dead in more than half the contexts);
 *                 each one is listed with the contexts whose look it changes
 *   --include-dirty  edit files that git reports dirty (default: skip and list them)
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PROBE_PATH = '/scripts/style/dead-override-probe/index.html';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[a.slice(2)] = true;
    else { out[a.slice(2)] = next; i++; }
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));
const OUT = resolve(REPO, args.out || 'tmp/style-codemod');

// -- tokens, from the real stylesheet ---------------------------------------------
const MODIFIERS = new Set(['typo-rtl', 'typo-hero-shine']);
function readTokens() {
  const css = readFileSync(join(REPO, 'src', 'styles', 'typography.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const names = new Set([...css.matchAll(/\.(typo-[a-z0-9]+(?:-[a-z0-9]+)*)(?![\w-])/g)].map((m) => m[1]));
  for (const m of MODIFIERS) names.delete(m);
  return names;
}
const TOKENS = readTokens();

// -- themes and scales, from the real sources ---------------------------------------
const THEMES = (() => {
  const src = readFileSync(join(REPO, 'src', 'stores', 'themeStore.ts'), 'utf8');
  const ids = [...src.matchAll(/\{\s*id:\s*'([a-z-]+)'/g)].map((m) => m[1]).filter((id) => id !== 'custom');
  return [...new Set(ids)].filter((id) => /^(dark|light)/.test(id));
})();
// The scales a user can pick: themeStore's TextScale union. globals.css still
// carries rules for the retired `compact` and `default` scales; `--scales` adds them.
const SCALES = args.scales ? String(args.scales).split(',') : (() => {
  const src = readFileSync(join(REPO, 'src', 'stores', 'themeStore.ts'), 'utf8');
  const m = /export type TextScale\s*=([^;]+);/.exec(src);
  if (!m) throw new Error('themeStore.ts: TextScale union not found; pass --scales');
  return [...m[1].matchAll(/'([a-z]+)'/g)].map((x) => x[1]);
})();

// -- families: the type utilities a token can override -----------------------------
const NON_TYPE_TEXT = /^text-(left|center|right|justify|start|end|wrap|nowrap|balance|pretty|ellipsis|clip)$/;
export function family(cls) {
  if (/^text-(xs|sm|base|lg|xl|[2-9]xl)$/.test(cls) || /^text-\[\d*\.?\d+(px|rem|em)\]$/.test(cls)) return 'size';
  if (/^text-/.test(cls) && !NON_TYPE_TEXT.test(cls) && !/^text-shadow/.test(cls)) return 'colour';
  if (/^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/.test(cls) || /^font-\[\d+\]$/.test(cls)) return 'weight';
  if (/^font-(sans|mono|serif)$/.test(cls)) return 'family';
  if (/^leading-/.test(cls)) return 'leading';
  if (/^tracking-/.test(cls)) return 'tracking';
  if (/^(normal-nums|ordinal|slashed-zero|lining-nums|oldstyle-nums|proportional-nums|tabular-nums|diagonal-fractions|stacked-fractions)$/.test(cls)) return 'numeric';
  return null;
}

// Variants that keep the same element (pseudo-classes, media, state and group/peer
// relations). Pseudo-element and descendant variants change the target: excluded.
const STATE_VARIANT = /^(hover|focus|focus-visible|focus-within|active|visited|disabled|enabled|checked|indeterminate|required|invalid|valid|read-only|open|empty|first|last|only|odd|even|first-of-type|last-of-type|target|default|placeholder-shown|autofill|sm|md|lg|xl|2xl|max-sm|max-md|max-lg|max-xl|max-2xl|motion-safe|motion-reduce|contrast-more|contrast-less|print|portrait|landscape|dark|rtl|ltr|(group|peer)(-[a-z-]+)?(\/[\w-]+)?|(aria|data)-[\w-]+|(aria|data|group-data|group-aria|peer-data|peer-aria)-\[[^\]\s]+\](\/[\w-]+)?|has-\[[^\]\s]+\]|in-[\w-]+)$/;

/** Split a class into { variants, base, important }; null when it cannot be classified. */
function parseClass(cls) {
  let important = false;
  let c = cls;
  const parts = [];
  // Split on ':' outside brackets.
  let depth = 0; let cur = '';
  for (const ch of c) {
    if (ch === '[') depth++;
    if (ch === ']') depth--;
    if (ch === ':' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
  }
  parts.push(cur);
  let base = parts.pop();
  if (base.startsWith('!')) { important = true; base = base.slice(1); }
  if (base.endsWith('!')) { important = true; base = base.slice(0, -1); }
  return { variants: parts, base, important };
}

// -- the source walk -----------------------------------------------------------------
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'target', 'coverage', '__tests__', '__mocks__']);
const isTest = (rel) => /\.(test|spec)\.(ts|tsx)$/.test(rel) || /(^|\/)(__tests__|__mocks__|test)\//.test(rel.replace(/^src\//, ''));
function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(p, out); }
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.d\.ts$/.test(e.name)) out.push(p);
  }
  return out;
}

function dirtyPaths() {
  const raw = execFileSync('git', ['status', '--porcelain', '-uall', '--', 'src'], { cwd: REPO, encoding: 'utf8' });
  const set = new Set();
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    const p = line.slice(3).split(' -> ').pop().replace(/^"|"$/g, '');
    set.add(p);
  }
  return set;
}

/**
 * The class pieces of a string-ish node, each with its raw source span.
 * Returns [{ start, end, text, leftOpen, rightOpen }] where start/end are the
 * offsets of the text between the delimiters and *Open marks a side touching
 * a `${}` expression (a token there is partial).
 */
function pieces(node, sf) {
  const src = sf.text;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    const start = node.getStart(sf) + 1; const end = node.end - 1;
    return [{ start, end, text: src.slice(start, end), leftOpen: false, rightOpen: false, escaped: src.slice(start, end) !== node.text }];
  }
  if (ts.isTemplateExpression(node)) {
    const out = [];
    const h = node.head; const hs = h.getStart(sf) + 1; const he = h.end - 2;
    out.push({ start: hs, end: he, text: src.slice(hs, he), leftOpen: false, rightOpen: true, escaped: false });
    for (const span of node.templateSpans) {
      const l = span.literal; const ls = l.getStart(sf) + 1;
      const tail = ts.isTemplateTail(l); const le = l.end - (tail ? 1 : 2);
      out.push({ start: ls, end: le, text: src.slice(ls, le), leftOpen: true, rightOpen: !tail, escaped: false });
    }
    return out.map((p) => ({ ...p, escaped: p.escaped || /\\/.test(p.text) }));
  }
  return [];
}

/** Whitespace-separated class tokens of a piece, with offsets; partial edge tokens flagged. */
function classTokens(piece) {
  const out = [];
  const re = /\S+/g; let m;
  while ((m = re.exec(piece.text))) {
    const s = m.index; const e = s + m[0].length;
    const partial = (piece.leftOpen && s === 0) || (piece.rightOpen && e === piece.text.length);
    out.push({ cls: m[0], s, e, partial });
  }
  return out;
}

function isClassAttr(node) {
  return ts.isJsxAttribute(node) && ['className', 'class'].includes(node.name.getText());
}

/** Collect the string-ish nodes of a className expression, marking conditional ones. */
function collectGroup(expr, cond, acc) {
  if (!expr) return;
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) { acc.push({ node: expr, cond }); return; }
  if (ts.isTemplateExpression(expr)) {
    acc.push({ node: expr, cond });
    // A span is always evaluated; only what IT makes conditional (a ternary, an &&) is.
    for (const span of expr.templateSpans) collectGroup(span.expression, cond, acc);
    return;
  }
  if (ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr) || ts.isNonNullExpression(expr) || ts.isSatisfiesExpression?.(expr)) { collectGroup(expr.expression, cond, acc); return; }
  if (ts.isJsxExpression(expr)) { collectGroup(expr.expression, cond, acc); return; }
  if (ts.isConditionalExpression(expr)) {
    collectGroup(expr.whenTrue, true, acc); collectGroup(expr.whenFalse, true, acc);
    // `c ? 'typo-a ..' : 'typo-b ..'`: one of the two always applies, so a utility
    // elsewhere in the attribute is governed by A in one case and B in the other.
    const unwrap = (e) => { while (ts.isParenthesizedExpression(e)) e = e.expression; return e; };
    const a = unwrap(expr.whenTrue); const b = unwrap(expr.whenFalse);
    const stringish = (e) => ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e) || ts.isTemplateExpression(e);
    if (!cond && stringish(a) && stringish(b)) acc.push({ alt: [a, b] });
    return;
  }
  if (ts.isBinaryExpression(expr)) {
    const k = expr.operatorToken.kind;
    if (k === ts.SyntaxKind.PlusToken) { collectGroup(expr.left, cond, acc); collectGroup(expr.right, cond, acc); return; }
    if (k === ts.SyntaxKind.AmpersandAmpersandToken) { collectGroup(expr.right, true, acc); return; }
    if (k === ts.SyntaxKind.BarBarToken || k === ts.SyntaxKind.QuestionQuestionToken) { collectGroup(expr.left, true, acc); collectGroup(expr.right, true, acc); return; }
    return;
  }
  if (ts.isArrayLiteralExpression(expr)) { for (const el of expr.elements) collectGroup(el, cond, acc); return; }
  // [..].join(' ') and [..].filter(Boolean).join(' ')
  if (ts.isCallExpression(expr) && ts.isPropertyAccessExpression(expr.expression) && expr.expression.name.text === 'join') {
    let target = expr.expression.expression;
    while (ts.isCallExpression(target) && ts.isPropertyAccessExpression(target.expression) && target.expression.name.text === 'filter') target = target.expression.expression;
    if (ts.isArrayLiteralExpression(target)) { for (const el of target.elements) collectGroup(el, cond, acc); return; }
  }
  acc.push({ opaque: true });
}

function scanFile(abs) {
  const rel = relative(REPO, abs).replace(/\\/g, '/');
  const src = readFileSync(abs, 'utf8');
  if (!/typo-/.test(src)) return null;
  const sf = ts.createSourceFile(abs, src, ts.ScriptTarget.Latest, true, abs.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const units = []; // { pieces, groupTokens, cond, groupId }
  const inGroup = new Set();
  let groupSeq = 0;
  const stats = { opaqueInGroups: 0, objectKeys: 0 };
  const visit = (node) => {
    if (isClassAttr(node) && node.initializer) {
      const acc = [];
      collectGroup(node.initializer, false, acc);
      const gid = ++groupSeq;
      const members = acc.filter((a) => a.node);
      const opaque = acc.filter((a) => a.opaque).length;
      stats.opaqueInGroups += opaque;
      const tokensOf = (n) => { const set = new Set(); for (const p of pieces(n, sf)) for (const t of classTokens(p)) if (!t.partial && TOKENS.has(t.cls)) set.add(t.cls); return set; };
      const alts = acc.filter((a) => a.alt).map((a) => ({ nodes: a.alt, sets: a.alt.map(tokensOf) })).filter((a) => a.sets.every((x) => x.size));
      const always = new Set();
      for (const m of members) {
        inGroup.add(m.node);
        if (m.cond) continue;
        for (const p of pieces(m.node, sf)) for (const t of classTokens(p)) if (!t.partial && TOKENS.has(t.cls)) always.add(t.cls);
      }
      for (const m of members) units.push({ node: m.node, cond: m.cond, groupTokens: always, alts, groupId: gid, opaque: opaque > 0 });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  const standalone = (node) => {
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) && !inGroup.has(node)) {
      const parent = node.parent;
      const keyPos = parent && (ts.isPropertyAssignment(parent) && parent.name === node);
      const moduleSpec = parent && (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent) || ts.isExternalModuleReference(parent));
      const typePos = parent && ts.isLiteralTypeNode(parent);
      if (keyPos) { if (/typo-/.test(node.text ?? '')) stats.objectKeys++; }
      else if (!moduleSpec && !typePos) units.push({ node, cond: false, groupTokens: new Set(), alts: [], groupId: 0, opaque: false });
    }
    // Inside a standalone template, nested literals are their own units.
    ts.forEachChild(node, standalone);
  };
  standalone(sf);
  return { rel, sf, src, units, stats };
}

// -- plan: which (token set, utility) cases each site needs ---------------------------
function plan(files) {
  const cases = new Map(); // key -> { tokens, utility, sites: [] }
  const sites = [];        // { rel, line, start, end, cls, base, key, family, variant }
  const unhandled = { conditionalOrIdentifierToken: 0, arbitraryOrPseudoVariant: 0, important: 0, escaped: 0, objectKeys: 0, opaqueInGroups: 0 };
  const unhandledSites = [];
  for (const f of files) {
    unhandled.objectKeys += f.stats.objectKeys;
    unhandled.opaqueInGroups += f.stats.opaqueInGroups;
    for (const u of f.units) {
      const ps = pieces(u.node, f.sf);
      // Tokens in this unit (for a template: all its static pieces).
      const own = new Set();
      for (const p of ps) for (const t of classTokens(p)) if (!t.partial && TOKENS.has(t.cls)) own.add(t.cls);
      // Every token set this unit can render with: its own and the attribute's
      // unconditional tokens, times each two-sided ternary it is not part of.
      let combos = [new Set([...own, ...u.groupTokens])];
      for (const alt of u.alts) {
        if (alt.nodes.includes(u.node)) continue;
        combos = combos.flatMap((c) => alt.sets.map((x) => new Set([...c, ...x])));
      }
      const governing = combos.length <= 8 && combos.every((c) => c.size) ? combos : [];
      for (const p of ps) {
        for (const t of classTokens(p)) {
          if (t.partial) continue;
          const pc = parseClass(t.cls);
          const fam = family(pc.base);
          if (!fam) continue;
          if (!governing.length) {
            if (u.groupId && !u.groupTokens.size) {
              // A utility in a className whose tokens are all conditional or opaque.
              const anyTokenInGroup = f.units.some((o) => o.groupId === u.groupId && pieces(o.node, f.sf).some((q) => classTokens(q).some((x) => TOKENS.has(x.cls))));
              if (anyTokenInGroup) { unhandled.conditionalOrIdentifierToken++; unhandledSites.push(`${f.rel}:${f.sf.getLineAndCharacterOfPosition(p.start + t.s).line + 1} ${t.cls} (token only in a conditional piece)`); }
            }
            continue;
          }
          if (p.escaped) { unhandled.escaped++; continue; }
          const at = () => `${f.rel}:${f.sf.getLineAndCharacterOfPosition(p.start + t.s).line + 1} ${t.cls}`;
          if (pc.important) { unhandled.important++; unhandledSites.push(`${at()} (important)`); continue; }
          if (pc.variants.length && !pc.variants.every((v) => STATE_VARIANT.test(v))) { unhandled.arbitraryOrPseudoVariant++; unhandledSites.push(`${at()} (arbitrary or pseudo-element variant)`); continue; }
          const keys = governing.map((g) => {
            const tokens = [...g].sort().join(' ');
            const key = `${tokens}|${pc.base}`;
            if (!cases.has(key)) cases.set(key, { tokens, utility: pc.base, family: fam, sites: 0 });
            cases.get(key).sites++;
            return key;
          });
          const line = f.sf.getLineAndCharacterOfPosition(p.start + t.s).line + 1;
          sites.push({ rel: f.rel, line, start: p.start + t.s, end: p.start + t.e, cls: t.cls, base: pc.base, key: keys[0], keys, family: fam, variant: pc.variants.length > 0, test: isTest(f.rel) });
        }
      }
    }
  }
  return { cases, sites, unhandled, unhandledSites };
}

// -- the browser -----------------------------------------------------------------------
async function startServer(preferredPort) {
  const { createServer } = await import('vite');
  for (let port = preferredPort; port < preferredPort + 10; port++) {
    try {
      const server = await createServer({
        configFile: join(REPO, 'vite.config.ts'), root: REPO,
        cacheDir: join(REPO, 'node_modules', `.vite-dead-probe-${port}`),
        logLevel: 'warn', clearScreen: false,
        optimizeDeps: { entries: [PROBE_PATH.slice(1)] },
        server: { port, strictPort: true, host: '127.0.0.1', hmr: false, watch: null },
      });
      await server.listen();
      return { server, url: `http://127.0.0.1:${port}` };
    } catch (err) {
      if (!/port .* in use|EADDRINUSE/i.test(String(err?.message ?? err))) throw err;
    }
  }
  throw new Error(`no free port in ${preferredPort}..${preferredPort + 9}`);
}

async function launchBrowser() {
  const { chromium } = await import('playwright');
  try { return await chromium.launch(); } catch (err) {
    if (!/Executable doesn't exist/.test(String(err?.message))) throw err;
    const cache = process.env.PLAYWRIGHT_BROWSERS_PATH || join(process.env.LOCALAPPDATA || '', 'ms-playwright');
    const builds = (existsSync(cache) ? readdirSync(cache) : [])
      .map((d) => /^chromium_headless_shell-(\d+)$/.exec(d)).filter(Boolean)
      .map((m) => ({ dir: m[0], rev: Number(m[1]) })).sort((a, b) => b.rev - a.rev);
    for (const b of builds) {
      const exe = join(cache, b.dir, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe');
      if (existsSync(exe)) return chromium.launch({ executablePath: exe });
    }
    throw err;
  }
}

async function probe(caseList, contexts) {
  const { server, url } = await startServer(Number(args.port || 1433));
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`${url}${PROBE_PATH}`, { waitUntil: 'networkidle', timeout: 180000 });
    await page.waitForFunction(() => window.__deadProbe?.ready, null, { timeout: 180000 });
    const res = await page.evaluate(([c, x]) => window.__deadProbe.run(c, x), [caseList.map(({ tokens, utility }) => ({ tokens, utility })), contexts]);
    if (errors.length) throw new Error(`probe page errors: ${errors.join(' | ')}`);
    return { ...res, browser: browser.version() };
  } finally {
    await browser.close();
    await server.close();
  }
}

// -- apply -----------------------------------------------------------------------------
/** Delete [start,end) from src with one run of spaces: the one after it when the
 *  token opens a line, a string or follows a `${}` (so `${x}` never glues to the
 *  next class), else the one before it. */
function applyDeletions(src, spans) {
  let out = src;
  const blank = (ch) => ch === ' ' || ch === '\t';
  for (const { start, end } of [...spans].sort((a, b) => b.start - a.start)) {
    let s = start; let e = end;
    let before = s; while (before > 0 && blank(out[before - 1])) before--;
    let after = e; while (after < out.length && blank(out[after])) after++;
    const boundaryBefore = before === 0 || /[\n"'`{}]/.test(out[before - 1]);
    if (after > e && (before === s || boundaryBefore)) e = after;
    else if (before < s && out[before - 1] !== '\n') s = before;
    out = out.slice(0, s) + out.slice(e);
  }
  return out;
}

// A deletion can leave a template piece that now adds nothing: `${c ? '' : ''}`
// or `${c && ''}`. Remove those, only where the edit created them.
const EMPTY_PIECES = [/ ?\$\{[^{}`$]*?\?\s*''\s*:\s*''\s*\}/g, / ?\$\{[^{}`$?]*?&&\s*''\s*\}/g];
function tidy(before, after) {
  let out = after;
  for (const re of EMPTY_PIECES) {
    const had = (before.match(re) ?? []).length;
    if (had === 0) out = out.replace(re, '');
  }
  return out;
}

// -- main --------------------------------------------------------------------------------
const contexts = THEMES.flatMap((theme) => SCALES.map((scale) => ({ theme, scale })));
mkdirSync(OUT, { recursive: true });

if (args.verify) {
  const base = JSON.parse(readFileSync(resolve(String(args.verify)), 'utf8'));
  const caseList = base.cases;
  const res = await probe(caseList, base.contexts);
  const diffs = [];
  caseList.forEach((c, i) => {
    base.contexts.forEach((ctx, j) => {
      const before = base.table[base.out[i][j][1]]; // tu today
      const [t, tu] = res.out[i][j];
      const now = res.table[c.deleted ? t : tu];
      if (before !== now) diffs.push({ tokens: c.tokens, utility: c.utility, deleted: !!c.deleted, sites: c.sites, ...ctx, before, now });
    });
  });
  const byCase = new Map();
  for (const d of diffs) { const k = `${d.tokens}|${d.utility}`; if (!byCase.has(k)) byCase.set(k, { ...d, contexts: [] }); byCase.get(k).contexts.push(`${d.theme}/${d.scale}`); }
  const rows = [...byCase.values()].map(({ theme, scale, ...r }) => r);
  writeFileSync(join(OUT, 'verify.json'), JSON.stringify({ baseline: args.verify, contexts: base.contexts.length, cases: caseList.length, differingCases: rows.length, differingSites: rows.reduce((n, r) => n + r.sites, 0), rows }, null, 1));
  console.log(`verify: ${caseList.length} cases x ${base.contexts.length} contexts; cases rendering differently: ${rows.length} (sites ${rows.reduce((n, r) => n + r.sites, 0)})`);
  for (const r of rows.slice(0, 40)) console.log(`  ${r.deleted ? 'deleted' : 'kept   '} ${r.tokens} + ${r.utility} (${r.sites} sites) in ${r.contexts.length} ctx, e.g. ${r.contexts[0]}`);
  process.exit(rows.length ? 1 : 0);
}

const files = walk(join(REPO, 'src')).map(scanFile).filter(Boolean);
const { cases, sites, unhandled, unhandledSites } = plan(files);
const caseList = [...cases.values()];
console.log(`scan: ${files.length} files with typo-*, ${sites.length} candidate sites, ${caseList.length} distinct cases; contexts ${contexts.length} (${THEMES.length} themes x ${SCALES.join('/')})`);
const res = await probe(caseList, contexts);
caseList.forEach((c, i) => {
  const rows = res.out[i];
  c.deadIn = rows.filter(([t, tu]) => t === tu).length;
  c.typographic = rows.some((r) => r[2] === 1);
  c.partly = c.typographic && c.deadIn > 0 && c.deadIn < contexts.length;
  c.dead = c.typographic && (c.deadIn === contexts.length || (!!args.majority && c.partly && c.deadIn * 2 > contexts.length));
  c.liveIn = rows.map((r, j) => (r[0] !== r[1] ? `${contexts[j].theme}/${contexts[j].scale}` : null)).filter(Boolean);
});
const dead = new Set(caseList.filter((c) => c.dead).map((c) => `${c.tokens}|${c.utility}`));

const dirty = args['include-dirty'] ? new Set() : dirtyPaths();
const plannedDeletes = sites.filter((s) => s.keys.every((k) => dead.has(k)));
const skippedDirty = new Set(); const skippedTests = new Set();
const byFile = new Map();
for (const s of plannedDeletes) {
  if (s.test) { skippedTests.add(s.rel); continue; }
  if (dirty.has(s.rel)) { skippedDirty.add(s.rel); continue; }
  if (!byFile.has(s.rel)) byFile.set(s.rel, []);
  byFile.get(s.rel).push(s);
}
const applied = [...byFile.values()].flat();
const fam = (list) => list.reduce((m, s) => ((m[s.family] = (m[s.family] ?? 0) + 1), m), {});
const hueIntent = applied.filter((s) => s.family === 'colour' && /^text-[a-z]+-\d{2,3}(\/\d+)?$/.test(s.base) && !/^text-(foreground|primary|muted)/.test(s.base));
const liveKept = caseList.filter((c) => c.partly && !c.dead);
const partlyDeleted = caseList.filter((c) => c.partly && c.dead);

const report = {
  generatedAt: new Date().toISOString(), browser: res.browser, tokens: [...TOKENS].sort(), contexts,
  counts: {
    candidateSites: sites.length, cases: caseList.length, deadCases: dead.size,
    deadSites: plannedDeletes.length, applied: applied.length, appliedByFamily: fam(applied),
    skippedDirtySites: plannedDeletes.filter((s) => skippedDirty.has(s.rel)).length,
    skippedTestSites: plannedDeletes.filter((s) => s.test).length,
    variantDeletes: applied.filter((s) => s.variant).length,
    partlyLiveCases: liveKept.length, partlyLiveSites: liveKept.reduce((n, c) => n + c.sites, 0),
  },
  unhandled, unhandledSites, skippedDirty: [...skippedDirty].sort(), skippedTests: [...skippedTests].sort(),
  hueIntent: hueIntent.map((s) => `${s.rel}:${s.line} ${s.cls}`),
  partlyLive: liveKept.map((c) => ({ tokens: c.tokens, utility: c.utility, sites: c.sites, liveIn: c.liveIn })),
  partlyDeleted: partlyDeleted.map((c) => ({ tokens: c.tokens, utility: c.utility, sites: c.sites, looksChangeIn: c.liveIn,
    at: plannedDeletes.filter((s) => s.keys.includes(`${c.tokens}|${c.utility}`)).map((s) => `${s.rel}:${s.line}`) })),
  deletions: applied.map((s) => `${s.rel}:${s.line} ${s.cls} (beside ${s.keys.map((k) => k.split('|')[0]).join(' / ')})`),
};
writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 1));
// The baseline a later --verify compares against: every case, what it renders today.
writeFileSync(join(OUT, 'baseline.json'), JSON.stringify({
  contexts, table: res.table, out: res.out,
  cases: caseList.map((c) => ({ tokens: c.tokens, utility: c.utility, sites: c.sites, deleted: c.dead })),
}));
console.log(`dead cases ${dead.size}/${caseList.length}; dead sites ${plannedDeletes.length}; by family ${JSON.stringify(fam(plannedDeletes))}`);
console.log(`skipped: dirty ${report.counts.skippedDirtySites} sites in ${skippedDirty.size} files, tests ${report.counts.skippedTestSites}; partly-live cases kept ${liveKept.length} (${report.counts.partlyLiveSites} sites)`);
console.log(`unhandled ${JSON.stringify(unhandled)}`);
console.log(`report ${join(OUT, 'report.json')}`);

if (args.apply) {
  for (const [rel, list] of byFile) {
    const abs = join(REPO, rel);
    const src = readFileSync(abs, 'utf8');
    writeFileSync(abs, tidy(src, applyDeletions(src, list)));
  }
  console.log(`applied ${applied.length} deletions in ${byFile.size} files`);
}
