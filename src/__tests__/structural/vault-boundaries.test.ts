import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Section 7 of `docs/security/credential-vault-threat-model.md` lists the vault
 * boundaries an agent must not cross. Until this test they were prose: an agent
 * could drop a credential command out of PRIVILEGED_COMMANDS, derive Serialize
 * on SecureString or flip a fail-closed env default and every gate stayed green.
 *
 * `docs/security/vault-boundaries.json` is the readable list, keyed by the
 * section 7 rule number. Each `checked` rule below reads the Rust source as text
 * and names the rule it guards in its failure, so the agent that crossed one
 * sees which line of the threat model it broke. Every check first asserts the
 * anchor it reads still exists: a check that finds nothing is broken, not green.
 */
const REPO = resolve(__dirname, '../../..');

interface ClosedDefault {
  variable: string;
  pattern: string;
}

interface Rule {
  id: number;
  title: string;
  kind: 'checked' | 'prose-only';
  reason?: string;
  types?: string[];
  mustBePrivileged?: string[];
  publicByDecision?: string[];
  closedDefaults?: ClosedDefault[];
  forbiddenInCrypto?: string;
  singleDefinition?: string;
}

interface Manifest {
  files: { crypto: string; ipcAuth: string; apiProxy: string; threatModel: string };
  rustRoots: string[];
  rules: Rule[];
}

// Parsed from a committed JSON file whose shape is declared above; every field a
// check reads is asserted non-empty inside that check before it is used.
const manifest = JSON.parse(readFileSync(join(REPO, 'docs/security/vault-boundaries.json'), 'utf8')) as Manifest;

const read = (rel: string) => readFileSync(join(REPO, rel), 'utf8');
const stripLineComments = (source: string) => source.replace(/\/\/.*$/gm, '');
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function rule(id: number): Rule {
  const found = manifest.rules.find((r) => r.id === id);
  if (!found) throw new Error(`docs/security/vault-boundaries.json has no rule ${id}`);
  return found;
}

let rustFileCache: { rel: string; text: string }[] | null = null;

/** Every `.rs` file under the manifest's crate roots, read once per run. */
function rustFiles(): { rel: string; text: string }[] {
  if (rustFileCache) return rustFileCache;
  const out: { rel: string; text: string }[] = [];
  const walk = (rel: string) => {
    for (const entry of readdirSync(join(REPO, rel), { withFileTypes: true })) {
      const child = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(child);
      else if (entry.name.endsWith('.rs')) out.push({ rel: child, text: read(child) });
    }
  };
  for (const root of manifest.rustRoots) {
    expect(existsSync(join(REPO, root)), `rust root ${root} is gone - update rustRoots`).toBe(true);
    walk(root);
  }
  expect(out.length, 'the Rust walk found almost no files - the walker is broken').toBeGreaterThan(100);
  rustFileCache = out;
  return out;
}

/** The string literals inside a Rust `&[...]` array, with `//` comment lines removed. */
function arrayBody(source: string, opener: string, closer: RegExp): string {
  const start = source.indexOf(opener);
  expect(start, `anchor \`${opener}\` not found`).toBeGreaterThanOrEqual(0);
  const rest = source.slice(start + opener.length);
  const end = rest.search(closer);
  expect(end, `end of \`${opener}\` not found`).toBeGreaterThan(0);
  return rest.slice(0, end);
}

function privilegedCommands(ipcAuth: string): Set<string> {
  const body = stripLineComments(arrayBody(ipcAuth, 'pub const PRIVILEGED_COMMANDS: &[&str] = &[', /\n\];/));
  return new Set([...body.matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1] ?? ''));
}

/** `DRIFT_BASELINE` in ipc_auth.rs: the tier ledger of annotated-but-unlisted commands and why. */
function tierLedger(ipcAuth: string): Map<string, string> {
  const body = stripLineComments(arrayBody(ipcAuth, 'const DRIFT_BASELINE: &[(&str, &str)] = &[', /\n\s*\];/));
  return new Map(
    [...body.matchAll(/\(\s*"([a-z0-9_]+)"\s*,\s*"([^"]+)"\s*,?\s*\)/g)].map((m): [string, string] => [m[1] ?? '', m[2] ?? '']),
  );
}

const CHECKS: Record<number, () => void> = {
  3: () => {
    const types = rule(3).types ?? [];
    expect(types.length).toBeGreaterThan(0);
    const files = rustFiles();
    for (const type of types) {
      const definitions = files.flatMap(({ rel, text }) => {
        const lines = text.split('\n');
        return lines
          .map((line, i) => ({ line, i }))
          .filter(({ line }) => new RegExp(`^\\s*pub struct ${type}\\b`).test(line))
          .map(({ i }) => ({ rel, lines, i }));
      });
      expect(definitions, `rule 3: expected exactly one \`pub struct ${type}\``).toHaveLength(1);
      const [definition] = definitions;
      if (!definition) return;
      const { rel, lines, i } = definition;
      const attributes: string[] = [];
      for (let j = i - 1; j >= 0 && /^\s*(#\[|\/\/\/)/.test(lines[j] ?? ''); j -= 1) attributes.push(lines[j] ?? '');
      expect(
        attributes.filter((a) => /\bSerialize\b/.test(a)),
        `rule 3: ${type} in ${rel} derives Serialize - a secret must leave only through expose_secret()`,
      ).toEqual([]);
      const impls = files.filter(({ text }) =>
        new RegExp(`impl(?:<[^>]*>)?\\s+(?:[\\w:]+::)?Serialize\\s+for\\s+${type}\\b`).test(stripLineComments(text)),
      );
      expect(
        impls.map((f) => f.rel),
        `rule 3: Serialize is implemented for ${type}`,
      ).toEqual([]);
    }
  },

  4: () => {
    const { mustBePrivileged = [], publicByDecision = [] } = rule(4);
    expect(mustBePrivileged.length).toBeGreaterThan(0);
    expect(publicByDecision.length).toBeGreaterThan(0);
    const ipcAuth = read(manifest.files.ipcAuth);
    const listed = privilegedCommands(ipcAuth);
    // Instrument first: the list holds well over a hundred commands.
    expect(listed.size, 'PRIVILEGED_COMMANDS parsed to almost nothing - the parser is broken').toBeGreaterThan(100);
    const ledger = tierLedger(ipcAuth);
    expect(ledger.size, 'DRIFT_BASELINE parsed to nothing - the parser is broken').toBeGreaterThan(5);

    expect(
      mustBePrivileged.filter((name) => !listed.has(name)),
      'rule 4: these secret-touching commands left PRIVILEGED_COMMANDS - for an async command that is zero enforcement',
    ).toEqual([]);
    expect(
      publicByDecision.filter((name) => listed.has(name)),
      'rule 4: now privileged - move it from publicByDecision to mustBePrivileged and update threat model 3.1',
    ).toEqual([]);
    expect(
      publicByDecision.filter((name) => !ledger.has(name)),
      'rule 4: an exclusion the threat model names is missing from the tier ledger (DRIFT_BASELINE)',
    ).toEqual([]);
    const deliberate = [...ledger].filter(([, reason]) => reason.startsWith('deliberate')).map(([name]) => name);
    expect(deliberate.length).toBeGreaterThan(0);
    expect(
      deliberate.filter((name) => !publicByDecision.includes(name)),
      'rule 4: a new deliberate exclusion in DRIFT_BASELINE is not in the threat model - add it to 3.1 and publicByDecision, and flag it for human review',
    ).toEqual([]);

    const doc = read(manifest.files.threatModel);
    expect(
      [...mustBePrivileged, ...publicByDecision].filter((name) => !doc.includes(`\`${name}\``)),
      'rule 4: the threat model does not name these commands',
    ).toEqual([]);
  },

  5: () => {
    const closedDefaults = rule(5).closedDefaults ?? [];
    expect(closedDefaults.length).toBeGreaterThan(0);
    const crypto = stripLineComments(read(manifest.files.crypto));
    const doc = read(manifest.files.threatModel);
    for (const { variable, pattern } of closedDefaults) {
      expect(crypto, `rule 5: ${variable} is no longer read with a fail-closed default`).toMatch(new RegExp(pattern));
      expect(doc, `rule 5: ${variable} is missing from threat model section 5`).toContain(`\`${variable}\``);
    }
  },

  6: () => {
    const forbidden = rule(6).forbiddenInCrypto;
    expect(forbidden).toBeTruthy();
    const crypto = stripLineComments(read(manifest.files.crypto));
    expect(crypto, 'rule 6: anchor OnceLock is gone from crypto.rs - re-point this check').toMatch(/OnceLock/);
    expect(crypto, 'rule 6: a Result is cached in a OnceLock - a transient keychain failure becomes permanent').not.toMatch(
      new RegExp(forbidden ?? '$^'),
    );
  },

  8: () => {
    const name = rule(8).singleDefinition;
    expect(name).toBeTruthy();
    const definition = new RegExp(`\\bfn ${escapeRegExp(name ?? '')}\\b`);
    const definedIn = rustFiles()
      .filter(({ text }) => definition.test(stripLineComments(text)))
      .map((f) => f.rel);
    expect(definedIn, `rule 8: ${name} must be defined once, in ${manifest.files.apiProxy}`).toEqual([manifest.files.apiProxy]);
  },
};

describe('credential vault boundaries (threat model section 7)', () => {
  it('lists exactly the numbered rules of section 7, each checked or explained', () => {
    const doc = read(manifest.files.threatModel);
    const start = doc.indexOf('## 7. Boundaries an agent must not cross');
    expect(start, 'threat model section 7 heading moved - update this test').toBeGreaterThanOrEqual(0);
    const section = doc.slice(start).split(/\n## /)[0];
    const numbered = [...section.matchAll(/^(\d+)\. \*\*/gm)].map((m) => Number(m[1]));
    expect(numbered.length).toBeGreaterThan(0);
    expect(manifest.rules.map((r) => r.id)).toEqual(numbered);
    for (const r of manifest.rules) {
      if (r.kind === 'prose-only') expect(r.reason, `rule ${r.id} is prose-only without a reason`).toBeTruthy();
      else expect(CHECKS[r.id], `rule ${r.id} is marked checked but has no check here`).toBeTypeOf('function');
    }
    for (const id of Object.keys(CHECKS).map(Number)) {
      expect(rule(id).kind, `a check exists for rule ${id}, which the manifest calls prose-only`).toBe('checked');
    }
  });

  for (const r of manifest.rules.filter((x) => x.kind === 'checked')) {
    it(`rule ${r.id}: ${r.title}`, () => {
      CHECKS[r.id]();
    });
  }

  it('parses the tier lists it relies on, and catches a command dropped from them', () => {
    const fake = [
      'pub const PRIVILEGED_COMMANDS: &[&str] = &[',
      '    "create_credential",',
      '    // "execute_api_request",',
      '];',
      '    const DRIFT_BASELINE: &[(&str, &str)] = &[',
      '        (',
      '            "export_full",',
      '            "deliberate: wrapper-level gate, see :396",',
      '        ),',
      '        ("get_api_proxy_metrics", "OWED: verify tier"),',
      '    ];',
    ].join('\n');
    expect([...privilegedCommands(fake)]).toEqual(['create_credential']);
    expect([...tierLedger(fake)]).toEqual([
      ['export_full', 'deliberate: wrapper-level gate, see :396'],
      ['get_api_proxy_metrics', 'OWED: verify tier'],
    ]);
  });
});
