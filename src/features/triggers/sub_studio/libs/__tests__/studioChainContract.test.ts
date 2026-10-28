// @vitest-environment node
/**
 * Every key the Studio writes into a chain trigger's config, and every
 * condition type it writes, has a reader in the Rust engine. The config is
 * stored as unparsed JSON, so a renamed key on either side passes create and
 * fails silently on every run: an unresolvable `jsonpath` or an unknown
 * condition type is treated as "do not fire" (db/src/chain.rs).
 *
 * studioCommit.test.ts pins the TS literals; this file pins them to the
 * readers. Reads src-tauri/db/src/chain.rs,
 * src-tauri/db/src/repos/resources/triggers/scheduling.rs and
 * src-tauri/core/src/models/trigger.rs.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DraftLink } from '../studioDraftModel';
import { draftLinkToTriggerInput, linkConditionToChain } from '../routeCodec';

function rust(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8').replace(/\/\/[^\n]*/g, '');
}

const CHAIN_RS = rust('src-tauri/db/src/chain.rs');
const SCHEDULING_RS = rust('src-tauri/db/src/repos/resources/triggers/scheduling.rs');
const TRIGGER_RS = rust('src-tauri/core/src/models/trigger.rs');

/** `config.get("k")` / `condition.get("k")` reads in the chain engine. */
function chainReads(receiver: 'config' | 'condition'): Set<string> {
  const re = new RegExp(`\\b${receiver}\\s*\\.get\\(\\s*"([a-z_]+)"`, 'g');
  return new Set([...CHAIN_RS.matchAll(re)].map((m) => m[1]!));
}

function rustConditionTypes(): Set<string> {
  const body = TRIGGER_RS.match(/VALID_VALUES:\s*&'static \[&'static str\]\s*=\s*&\[([^\]]*)\]/)?.[1];
  expect(body, 'ChainConditionType::VALID_VALUES not found').toBeDefined();
  return new Set([...body!.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]!));
}

const link = (over: Partial<DraftLink>): DraftLink => ({
  id: 'l1',
  source: { kind: 'persona', personaId: 'src-1' },
  targetPersonaId: 'tgt-1',
  condition: null,
  ...over,
});

describe('Studio chain config against the Rust readers', () => {
  const conditions: DraftLink['condition'][] = [null, 'on_success', 'on_failure', 'output_match'];
  const configs = conditions.map((condition) => {
    const input = draftLinkToTriggerInput(link({ condition, outputMatch: { path: '$.result.status', expected: 'approved' } }));
    expect(input, String(condition)).not.toBeNull();
    return JSON.parse(input!.config) as Record<string, unknown>;
  });

  it('writes only top-level keys the chain engine or its source lookup reads', () => {
    const configKeys = chainReads('config');
    for (const cfg of configs) {
      for (const key of Object.keys(cfg)) {
        if (key === 'source_persona_id') {
          // Read in SQL by the source lookup, not by config.get.
          expect(SCHEDULING_RS).toMatch(/json_extract\(config,\s*'\$\.source_persona_id'\)/);
        } else {
          expect(configKeys, `chain.rs never reads config.${key}`).toContain(key);
        }
      }
    }
  });

  it('writes only condition types the engine parses', () => {
    const valid = rustConditionTypes();
    for (const cfg of configs) {
      const type = (cfg.condition as { type?: unknown }).type;
      expect(valid, `ChainConditionType has no "${String(type)}"`).toContain(type);
    }
  });

  it('writes the jsonpath condition with the field names evaluate_predicate reads', () => {
    const cond = linkConditionToChain({ condition: 'output_match', outputMatch: { path: '$.a', expected: 'b' } });
    const condKeys = chainReads('condition');
    for (const key of Object.keys(cond!)) expect(condKeys, `chain.rs never reads condition.${key}`).toContain(key);
  });
});
