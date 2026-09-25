/**
 * actionRisk — the drift gate. sweep #262.
 *
 * Ground truth is the backend's own vocabulary: `ALLOWED_ACTIONS` in
 * `src-tauri/src/companion/dispatcher/catalog.rs`, the list that decides which
 * ops can become an approval row at all. The risk table in `../actionRisk` is a
 * second copy of those names, and until this file existed nothing compared
 * them: an action added to the backend simply never appeared in the frontend's
 * eight-name Set, and the orb recommended "look closer" for it forever.
 *
 * Same shape as `personaCore.test.tsx`, which reads the shipped archetype JSON
 * rather than another list in its own folder.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

import { actionRisk, classifiedActions, isClassified, lowRiskActions, NON_APPROVAL_LOW_RISK } from '../actionRisk';

/** Parse the Rust allow-list, ignoring its (heavily commented) prose. */
function allowedActions(): string[] {
  const src = readFileSync(
    path.resolve(process.cwd(), 'src-tauri/src/companion/dispatcher/catalog.rs'),
    'utf8',
  );
  const block = /ALLOWED_ACTIONS: &\[&str\] = &\[([\s\S]*?)\n\];/.exec(src);
  if (!block) throw new Error('ALLOWED_ACTIONS block not found in catalog.rs');
  const body = block[1]!
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
  return [...body.matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1]!);
}

describe('actionRisk is checked against the backend action catalog', () => {
  it('reads a non-empty allow-list (instrument check)', () => {
    // A regex that silently matched nothing would make every assertion below
    // pass while checking nothing.
    expect(allowedActions().length).toBeGreaterThan(20);
  });

  it('classifies every action the backend can propose', () => {
    // Both arms are named, so "nobody has looked at this verb" is a state the
    // test can SEE. With only a low table every string would be elevated by
    // fallthrough and this assertion could never fail.
    const unclassified = allowedActions().filter((a) => !isClassified(a));
    expect(unclassified).toEqual([]);
  });

  it('has no entry the backend no longer accepts', () => {
    const allowed = new Set(allowedActions());
    const stale = classifiedActions().filter(
      (a) => !allowed.has(a) && !NON_APPROVAL_LOW_RISK.includes(a),
    );
    expect(stale).toEqual([]);
    // The low table is the half that changes a recommendation, so it is worth
    // its own assertion rather than only the union's.
    expect(lowRiskActions().filter((a) => !allowed.has(a))).toEqual([...NON_APPROVAL_LOW_RISK]);
  });

  it('keeps the memory-write family together', () => {
    // The drift this card was filed for: write_fact was low, write_procedural
    // was not, and nothing about their blast radius differs.
    for (const a of ['write_fact', 'write_procedural', 'write_goal', 'write_ritual']) {
      expect(actionRisk(a)).toBe('low');
    }
  });

  it('keeps everything that spawns, deletes or leaves the machine elevated', () => {
    for (const a of [
      'delete_fact',
      'delete_goal',
      'fleet_kill',
      'dev_merge',
      'browser_act',
      'remote_instruct',
      'run_browser_test',
      'backlog_apply_triage',
    ]) {
      expect(actionRisk(a)).toBe('elevated');
    }
  });

  it('treats an unrecognized action as elevated, never as safe', () => {
    expect(actionRisk('some_verb_shipped_tomorrow')).toBe('elevated');
    expect(actionRisk('')).toBe('elevated');
  });
});
