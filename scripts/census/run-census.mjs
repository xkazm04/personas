#!/usr/bin/env node
/**
 * Census runner — ONE gate mechanism for the golden-path corpus.
 *
 * Why this exists
 * ---------------
 * `docs/concepts/golden-path-contract.md` §9 requires every golden path to
 * propose its own enforcement. 247 situation leaves x ~2 gates each is ~460
 * bespoke scripts, and three paths already specified near-identical mechanisms
 * independently (`tables.md` Gaps 9/10, `inline-busy-state.md` §9,
 * `dropdown-and-select.md` §9 — each an ESLint rule + RuleTester cases + a
 * ratcheting baseline script, each with the same failure-mode analysis).
 *
 * This is the ratcheting-baseline half of that mechanism, built once. Adding a
 * gate becomes an entry in `rules.json`, not a new file.
 *
 * The fail-loud contract
 * ----------------------
 * §9 also requires that a gate fail loudly when ITS OWN precondition is absent,
 * because this repo is a museum of gates that ran green while checking nothing:
 * `ci.yml` ran `cargo test` without `--workspace` so a whole crate's suite never
 * ran; `scripts/secret-scan.mjs` exits 0 when gitleaks is absent;
 * `custom/no-unmanaged-effect-resources` measures precision 0/3, recall 0/3.
 * So this runner treats "found nothing" and "looked at nothing" as different
 * outcomes, and only one of them is success:
 *
 *   - walk sees fewer files than `floor`      -> exit 1 ("matcher broken, not codebase clean")
 *   - a rule matches zero files anywhere      -> exit 1
 *   - an `exclude` entry matches nothing      -> exit 1 (stale exemption)
 *   - a count rises above `baseline`          -> exit 1 under --check
 *   - a count DROPS below `baseline`          -> exit 1 under --check (a silent
 *                                                drop is usually a broken matcher)
 *   - success                                 -> prints the surviving counts, so
 *                                                a build log distinguishes a run
 *                                                that was clean from one that
 *                                                checked nothing
 *
 * And it has its own self-test: `node scripts/census/self-test.mjs` runs the
 * same engine over `scripts/census/__fixtures__/` with known-count fixtures and
 * asserts every failure mode above actually fires.
 *
 * Usage
 * -----
 *   npm run census                 # report; structural failures are still fatal
 *   npm run census:check           # report + baseline drift is fatal (the gate)
 *   npm run census -- --update     # ratchet baselines to the measured reality
 *   npm run census -- --rule raw-select --verbose
 *   npm run census -- --json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertRule, scanRule, validateRule } from './lib/engine.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');

function parseArgs(argv) {
  const args = {
    check: false,
    update: false,
    json: false,
    verbose: false,
    rule: null,
    rulesFile: resolve(HERE, 'rules.json'),
    root: REPO_ROOT,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check') args.check = true;
    else if (a === '--update') args.update = true;
    else if (a === '--json') args.json = true;
    else if (a === '--verbose' || a === '-v') args.verbose = true;
    else if (a === '--rule') args.rule = argv[++i];
    else if (a === '--rules') args.rulesFile = resolve(process.cwd(), argv[++i]);
    else if (a === '--root') args.root = resolve(process.cwd(), argv[++i]);
    else if (a === '--help' || a === '-h') {
      console.log(readFileSync(new URL(import.meta.url)).toString().split('*/')[0]);
      process.exit(0);
    } else {
      console.error(`census: unknown argument "${a}"`);
      process.exit(2);
    }
  }
  return args;
}

const c = {
  red: (s) => `[31m${s}[0m`,
  green: (s) => `[32m${s}[0m`,
  yellow: (s) => `[33m${s}[0m`,
  dim: (s) => `[2m${s}[0m`,
  bold: (s) => `[1m${s}[0m`,
};

/**
 * Run the census. Returns `{ exitCode, results, problemsByRule }` instead of
 * exiting, so `self-test.mjs` can assert on failures rather than dying on them.
 */
export function runCensus(args) {
  const registry = JSON.parse(readFileSync(args.rulesFile, 'utf8'));
  const allRules = registry.rules ?? [];

  // A malformed registry must never scan "successfully".
  const schemaErrors = allRules.flatMap((rule, i) => validateRule(rule, i));
  if (schemaErrors.length > 0) {
    for (const e of schemaErrors) console.error(c.red(`census: ${e}`));
    return { exitCode: 1, results: [], problemsByRule: new Map(), schemaErrors };
  }

  const rules = args.rule ? allRules.filter((r) => r.id === args.rule) : allRules;
  if (rules.length === 0) {
    console.error(
      c.red(
        args.rule
          ? `census: no rule with id "${args.rule}" in ${args.rulesFile}`
          : `census: the rule registry is empty — ${args.rulesFile} declares no rules, ` +
            `so this run checked nothing at all`,
      ),
    );
    return { exitCode: 1, results: [], problemsByRule: new Map() };
  }

  const results = [];
  const problemsByRule = new Map();
  for (const rule of rules) {
    const result = scanRule(rule, { root: args.root });
    results.push({ rule, result });
    problemsByRule.set(rule.id, assertRule(rule, result));
  }

  const structural = [...problemsByRule.values()].flat().filter((p) => p.kind === 'structural');
  const drift = [...problemsByRule.values()].flat().filter((p) => p.kind === 'drift');

  let exitCode = 0;
  if (structural.length > 0) exitCode = 1;
  else if (args.check && drift.length > 0) exitCode = 1;

  return { exitCode, results, problemsByRule };
}

function report(args, { results, problemsByRule, exitCode }) {
  if (args.json) {
    console.log(
      JSON.stringify(
        {
          ok: exitCode === 0,
          mode: args.check ? 'check' : 'report',
          rules: results.map(({ rule, result }) => ({
            id: rule.id,
            goldenPath: rule.goldenPath,
            walked: result.walked,
            scanned: result.scanned,
            files: result.files,
            matches: result.matches,
            baseline: rule.baseline,
            floor: rule.floor,
            commentMatchesSkipped: result.commentMatchesSkipped,
            problems: problemsByRule.get(rule.id),
            hits: args.verbose ? result.hits : undefined,
          })),
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(c.bold('\ncensus') + c.dim(`  ${args.check ? 'check (drift is fatal)' : 'report'}`));
  console.log(c.dim('  golden-path enforcement — one runner, N declarative rules\n'));

  const pad = (s, n) => String(s).padEnd(n);
  const lpad = (s, n) => String(s).padStart(n);
  console.log(
    c.dim(
      `  ${pad('rule', 22)} ${lpad('files', 6)} ${lpad('base', 6)} ${lpad('matches', 8)} ` +
        `${lpad('base', 6)} ${lpad('walked', 7)} ${lpad('floor', 6)}`,
    ),
  );

  for (const { rule, result } of results) {
    const problems = problemsByRule.get(rule.id) ?? [];
    const bad = problems.some((p) => p.kind === 'structural') || (args.check && problems.length > 0);
    const mark = problems.length === 0 ? c.green('OK  ') : bad ? c.red('FAIL') : c.yellow('DRIFT');
    console.log(
      `  ${mark} ${pad(rule.id, 22)} ${lpad(result.files, 6)} ${lpad(rule.baseline.files, 6)} ` +
        `${lpad(result.matches, 8)} ${lpad(rule.baseline.matches, 6)} ` +
        `${lpad(result.walked, 7)} ${lpad(rule.floor, 6)}`,
    );
  }

  for (const { rule, result } of results) {
    const problems = problemsByRule.get(rule.id) ?? [];
    if (problems.length === 0 && !args.verbose) continue;
    console.log(`\n  ${c.bold(rule.id)} ${c.dim('-> ' + rule.goldenPath)}`);
    console.log(c.dim(`    signal: ${rule.signal.description}`));
    if (result.commentMatchesSkipped > 0) {
      console.log(
        c.dim(
          `    ${result.commentMatchesSkipped} match(es) ignored on comment-only lines ` +
            `(prose about the migration is not a violation of it)`,
        ),
      );
    }
    for (const ex of result.excludes) {
      console.log(c.dim(`    exclude ${ex.path} (${ex.hits} file(s)) — ${ex.reason}`));
    }
    for (const p of problems) {
      const tag = p.kind === 'structural' ? c.red('[structural]') : c.yellow('[drift]');
      console.log(`    ${tag} ${p.message}`);
    }
    if (args.verbose) {
      for (const hit of result.hits.slice(0, 40)) {
        console.log(c.dim(`      ${hit.file}:${hit.lines.join(',')}  (${hit.matches})`));
      }
      if (result.hits.length > 40) console.log(c.dim(`      ... and ${result.hits.length - 40} more files`));
    }
  }

  // ALWAYS print the surviving counts on success. A build log must be able to
  // tell a run that was clean apart from a run that checked nothing.
  const totalFiles = results.reduce((n, r) => n + r.result.files, 0);
  const totalMatches = results.reduce((n, r) => n + r.result.matches, 0);
  const totalWalked = results.reduce((n, r) => n + r.result.walked, 0);
  console.log(
    `\n  ${exitCode === 0 ? c.green('census OK') : c.red('census FAILED')} — ` +
      `${results.length} rule(s), ${totalWalked} file-visits, ` +
      `${totalMatches} surviving violation(s) across ${totalFiles} file(s).`,
  );
  if (exitCode !== 0) {
    console.log(c.dim('  (structural failures mean the runner is broken; drift means the codebase moved)'));
  }
  console.log('');
}

function updateBaselines(args, results) {
  const registry = JSON.parse(readFileSync(args.rulesFile, 'utf8'));
  const changed = [];
  for (const { rule, result } of results) {
    const target = registry.rules.find((r) => r.id === rule.id);
    if (!target) continue;
    if (target.baseline.files !== result.files || target.baseline.matches !== result.matches) {
      changed.push(
        `  ${rule.id}: files ${target.baseline.files} -> ${result.files}, ` +
          `matches ${target.baseline.matches} -> ${result.matches}`,
      );
      target.baseline = { files: result.files, matches: result.matches };
    }
  }
  writeFileSync(args.rulesFile, JSON.stringify(registry, null, 2) + '\n', 'utf8');
  if (changed.length === 0) console.log('census: baselines already match measured reality; nothing to update.');
  else {
    console.log('census: baselines updated —');
    for (const line of changed) console.log(line);
    console.log(c.dim('  Review this diff. A DOWNWARD move should have a fix commit behind it.'));
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const outcome = runCensus(args);

  if (args.update) {
    // Structural failures make measurements meaningless — never bake them in.
    const structural = [...outcome.problemsByRule.values()].flat().filter((p) => p.kind === 'structural');
    if (structural.length > 0) {
      report(args, outcome);
      console.error(c.red('census: refusing to --update while structural assertions fail.'));
      process.exit(1);
    }
    updateBaselines(args, outcome.results);
    process.exit(0);
  }

  report(args, outcome);
  process.exit(outcome.exitCode);
}
