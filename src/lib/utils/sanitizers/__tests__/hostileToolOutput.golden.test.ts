// GOLDEN EVAL — hostile connector output vs. the credential masker.
//
// The riskiest failure for an app that hands agents a credential vault is not a
// bad answer, it is a persona coaxed by TOOL OUTPUT (an issue body, a Slack
// thread, a scraped page, a database row) into echoing a credential. The
// recorded attacks in evals/fixtures/prompt-injection/tool-output-attacks.json
// are each what a connector returns when the far side is hostile. This runs
// them through the REAL `maskSensitiveJson`, the masker on the execution-output
// view (ExecutionDetailContent) and on cloud-review payloads (sanitizeCloudReview), and
// asserts the load-bearing property: no credential-shaped value, and no value
// under a secret-named key, survives into the text a human sees or copies.
//
// What this does NOT cover, stated rather than implied: whether the Rust engine
// strips the injected INSTRUCTIONS before the model reads the tool result, or
// stops a persona calling a second connector with a vault value. Those run in
// src-tauri, outside the TypeScript lanes. The prompt-bound sanitizers for
// imported workflows and template variables are covered by
// evals/prompts/prompt-injection-defense.golden.test.ts.
//
// Lives in the default Vitest lane, not `npm run test:evals`, because
// maskSensitive.ts resolves `@/lib/silentCatch` and the evals lane is alias-free.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { maskSensitiveJson } from '../maskSensitive';

const REPO = resolve(__dirname, '../../../../..');

interface AttackCase {
  label: string;
  connector: string;
  output: unknown;
  secrets: string[];
  keep: string[];
}

const fx = JSON.parse(
  readFileSync(resolve(REPO, 'evals/fixtures/prompt-injection/tool-output-attacks.json'), 'utf8'),
) as { jsonToolOutputs: AttackCase[]; textToolOutputs: AttackCase[] };

// Fake credentials in the SHAPE each provider issues, assembled from fragments
// so neither this file nor the fixture holds a string a secret scanner flags.
const FAKE: Record<string, string> = {
  GITHUB_PAT: ['ghp', 'Ab1'.repeat(12)].join('_'),
  SLACK_BOT: ['xoxb', '1234567890', 'abcdefABCDEF'].join('-'),
  ANTHROPIC: ['sk', 'ant', 'api03' + 'Zq9'.repeat(10)].join('-'),
  AWS_ACCESS_KEY: 'AKIA' + 'Q7RT'.repeat(4),
  STRIPE_LIVE: ['sk', 'live', 'Rk4'.repeat(8)].join('_'),
  JWT: ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiJ4In0', 'c2lnbmF0dXJl'].join('.'),
  GOOGLE: 'AIza' + 'Sy' + 'Ab3De'.repeat(6) + 'xyz',
  // No recognisable shape: only the key name can protect these.
  UNSHAPED_A: ['plain', 'value', 'alpha'].join('-'),
  UNSHAPED_B: ['plain', 'value', 'bravo'].join('-'),
  UNSHAPED_C: ['plain', 'value', 'charlie'].join('-'),
};

function fill(text: string): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => {
    const value = FAKE[name];
    if (value === undefined) throw new Error(`fixture names an unknown fake credential: ${name}`);
    return value;
  });
}

function rawOf(c: AttackCase): string {
  return typeof c.output === 'string' ? fill(c.output) : fill(JSON.stringify(c.output));
}

describe('hostile tool output: the fixture is real', () => {
  it('carries both JSON and plain-text attacks', () => {
    expect(fx.jsonToolOutputs.length).toBeGreaterThanOrEqual(4);
    expect(fx.textToolOutputs.length).toBeGreaterThanOrEqual(2);
  });

  for (const c of [...fx.jsonToolOutputs, ...fx.textToolOutputs]) {
    it(`"${c.label}" names a built-in connector and plants every secret it declares`, () => {
      expect(existsSync(resolve(REPO, 'scripts/connectors/builtin', `${c.connector}.json`))).toBe(true);
      const raw = rawOf(c);
      expect(c.secrets.length).toBeGreaterThan(0);
      for (const name of c.secrets) expect(raw).toContain(FAKE[name]);
    });
  }
});

describe('hostile tool output: maskSensitiveJson on structured results', () => {
  for (const c of fx.jsonToolOutputs) {
    it(`"${c.label}" shows no planted credential and keeps the legitimate content`, () => {
      const masked = maskSensitiveJson(rawOf(c));
      expect(typeof masked).toBe('string');
      for (const name of c.secrets) expect(masked).not.toContain(FAKE[name]);
      for (const kept of c.keep) expect(masked).toContain(kept);
      // Still JSON: the execution view renders it through a JSON highlighter.
      expect(() => JSON.parse(masked as string)).not.toThrow();
    });
  }

  it('masks secret-named columns by suffix, but not token COUNTS', () => {
    const row = fx.jsonToolOutputs.find((c) => c.label === 'db-row-with-prefixed-secret-columns')!;
    const parsed = JSON.parse(maskSensitiveJson(rawOf(row)) as string) as {
      rows: Record<string, unknown>[];
    };
    expect(parsed.rows[0]).toMatchObject({
      id: 7,
      githubToken: '********',
      DB_PASSWORD: '********',
      service_api_key: '********',
      max_tokens: 4096,
      owner: 'platform-team',
    });
  });

  it('leaves a clean result byte-identical', () => {
    const clean = JSON.stringify({ title: 'Weekly digest', max_tokens: 1024, tokenCount: 3, items: ['a', 'b'] });
    expect(maskSensitiveJson(clean)).toBe(clean);
  });
});

describe('hostile tool output: maskSensitiveJson on plain-text results', () => {
  for (const c of fx.textToolOutputs) {
    it(`"${c.label}" shows no planted credential and keeps the legitimate content`, () => {
      const masked = maskSensitiveJson(rawOf(c));
      for (const name of c.secrets) expect(masked).not.toContain(FAKE[name]);
      for (const kept of c.keep) expect(masked).toContain(kept);
    });
  }
});
