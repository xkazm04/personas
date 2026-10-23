import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';

/**
 * `.claude/rules/*.md` reach an agent by their `paths:` frontmatter: Claude
 * Code loads `ui.md` only when a touched file matches `src/**\/*.tsx`, and every
 * other harness reads the same globs out of the routing table in AGENTS.md.
 * Nothing ran either one against the tree. A refactor that moved the UI under a
 * new root would leave the glob matching nothing, and the rules would stop
 * loading without an error anywhere. "Loaded for no file" looks exactly like
 * "no file needed it".
 *
 * So this test holds three things:
 *   - every glob in every project rules file matches at least one real file;
 *   - every rules file has a row in AGENTS.md;
 *   - that row lists the frontmatter's globs exactly, so the two copies of the
 *     routing cannot drift apart.
 *
 * `ai-registry-*.md` are links into the shared registry checkout (see the AI
 * registry section of `.claude/CLAUDE.md`). They load in every session by
 * design, carry no `paths:`, and may be absent from a checkout, so they are not
 * this repo's routing and are skipped. So is any symlink.
 *
 * THE INSTRUMENT IS ASSERTED BEFORE THE RESULT: a walk that found no rules files
 * would otherwise report perfect routing.
 */
const REPO = resolve(__dirname, '../../..');
const RULES_DIR = resolve(REPO, '.claude/rules');
const AGENTS_MD = resolve(REPO, 'AGENTS.md');

// Measured 2026-10-10: ui.md, i18n.md, rust-backend.md.
const MIN_RULES_FILES = 3;

const SKIP_DIRS = new Set(['node_modules', '.git', 'target']);

/** Translate a frontmatter glob (`*`, `**`, `?`) into an anchored RegExp over `/`-separated paths. */
function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // `**/` spans zero or more whole directories; any other `**` spans the rest.
        if (glob[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 2;
        } else {
          re += '.*';
          i += 1;
        }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`);
}

/**
 * The first file under `root` that `glob` matches, or null. The walk starts at
 * the glob's literal prefix (`src-tauri/**` walks only `src-tauri/`) and stops
 * at the first hit, so a broad glob costs one directory read.
 */
function firstMatch(root: string, glob: string): string | null {
  const segments = glob.split('/');
  const wild = segments.findIndex((s) => /[*?]/.test(s));
  if (wild === -1) return existsSync(join(root, glob)) ? glob : null;
  const prefix = segments.slice(0, wild).join('/');
  if (prefix && !existsSync(join(root, prefix))) return null;

  const re = globToRegExp(glob);
  const stack = [prefix];
  while (stack.length > 0) {
    const rel = stack.pop() as string;
    for (const entry of readdirSync(join(root, rel), { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) stack.push(childRel);
      } else if (entry.isFile() && re.test(childRel)) {
        return childRel;
      }
    }
  }
  return null;
}

/** The `paths:` list of a rules file's YAML frontmatter; [] when it has none. */
function frontmatterPaths(text: string): string[] {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) return [];
  const doc = yaml.load(match[1]);
  const paths = doc !== null && typeof doc === 'object' ? (doc as { paths?: unknown }).paths : undefined;
  return Array.isArray(paths) ? paths.filter((p): p is string => typeof p === 'string') : [];
}

interface RoutingRow {
  rulesFile: string;
  globs: string[];
}

/** Rows of AGENTS.md's routing table whose "Read" cell names a `.claude/rules/*.md` file. */
function routingRows(markdown: string): RoutingRow[] {
  const rows: RoutingRow[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1);
    if (cells.length < 2) continue;
    const target = /`\.claude\/rules\/([^`]+\.md)`/.exec(cells[1]);
    if (!target) continue;
    const globs = [...cells[0].matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    rows.push({ rulesFile: target[1], globs });
  }
  return rows;
}

function projectRulesFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md') && !f.startsWith('ai-registry-'))
    .filter((f) => !lstatSync(join(dir, f)).isSymbolicLink())
    .sort();
}

describe('rules-file path globs', () => {
  const files = projectRulesFiles(RULES_DIR);
  const rules = files.map((file) => ({ file, globs: frontmatterPaths(readFileSync(join(RULES_DIR, file), 'utf8')) }));
  const rows = routingRows(readFileSync(AGENTS_MD, 'utf8'));

  it('actually read the rules files (instrument before result)', () => {
    expect(files.length, `found ${files.length} rules file(s) in .claude/rules; the walk is broken, not the routing clean`).toBeGreaterThanOrEqual(MIN_RULES_FILES);
    expect(
      rules.filter((r) => r.globs.length === 0).map((r) => r.file),
      'a project rules file with no `paths:` frontmatter is either always-loaded by accident or its frontmatter stopped parsing',
    ).toEqual([]);
  });

  it('every glob matches at least one file in the tree', () => {
    const dead = rules.flatMap(({ file, globs }) => globs.filter((g) => firstMatch(REPO, g) === null).map((g) => `${file}: ${g}`));
    expect(dead, 'these globs match no file, so their rules never load: re-point them at where the code moved').toEqual([]);
  });

  it('AGENTS.md routes every rules file with the same globs', () => {
    expect(rules.filter((r) => !rows.some((row) => row.rulesFile === r.file)).map((r) => r.file), 'add a row to the "Read before you change anything" table in AGENTS.md').toEqual([]);
    expect(rows.filter((row) => !files.includes(row.rulesFile)).map((row) => row.rulesFile), 'AGENTS.md routes to a rules file that does not exist').toEqual([]);
    for (const { file, globs } of rules) {
      for (const row of rows.filter((r) => r.rulesFile === file)) {
        expect([...row.globs].sort(), `AGENTS.md's row for ${file} must list its frontmatter globs verbatim`).toEqual([...globs].sort());
      }
    }
  });

  it('the instruments discriminate (each fails on the shape it exists to catch)', () => {
    const tsx = globToRegExp('src/**/*.tsx');
    expect(['src/a.tsx', 'src/x/y/a.tsx'].map((p) => tsx.test(p))).toEqual([true, true]);
    expect(['src/a.ts', 'lib/a.tsx', 'src/a.tsx.bak'].map((p) => tsx.test(p))).toEqual([false, false, false]);
    const tree = globToRegExp('src-tauri/**');
    expect(['src-tauri/Cargo.toml', 'src-tauri/src/lib.rs', 'src-tauriX/a'].map((p) => tree.test(p))).toEqual([true, true, false]);
    const nested = globToRegExp('src/features/**/i18n/**');
    expect(['src/features/a/i18n/en.ts', 'src/features/i18n/x.ts', 'src/i18n/x.ts'].map((p) => nested.test(p))).toEqual([true, true, false]);

    expect(frontmatterPaths('---\r\npaths:\r\n  - "src/**/*.tsx"\r\n  - src/**/*.css\r\n---\r\n# body')).toEqual(['src/**/*.tsx', 'src/**/*.css']);
    expect(frontmatterPaths('# no frontmatter\npaths:\n  - "x"\n')).toEqual([]);

    expect(
      routingRows('| You are touching | Read |\n|---|---|\n| `src/**/*.tsx`, UI | `.claude/rules/ui.md`, then more |\n| `docs/**` | `docs/x.md` |\n'),
    ).toEqual([{ rulesFile: 'ui.md', globs: ['src/**/*.tsx'] }]);

    // A UI that moved under a new root: the glob stops matching, and the walk says so.
    const root = mkdtempSync(join(tmpdir(), 'rules-globs-'));
    try {
      mkdirSync(join(root, 'app', 'ui'), { recursive: true });
      writeFileSync(join(root, 'app', 'ui', 'Button.tsx'), '');
      mkdirSync(join(root, 'src'), { recursive: true });
      writeFileSync(join(root, 'src', 'index.ts'), '');
      expect(firstMatch(root, 'src/**/*.tsx')).toBeNull();
      expect(firstMatch(root, 'gone/**')).toBeNull();
      expect(firstMatch(root, 'app/**/*.tsx')).toBe('app/ui/Button.tsx');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
