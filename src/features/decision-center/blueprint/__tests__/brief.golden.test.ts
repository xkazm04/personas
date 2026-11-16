// @vitest-environment node
/**
 * The decision brief's port (model/brief.ts), held by bp's own golden: every case of bp's
 * docs/concepts/decision-brief/golden.json, run through the port, must come out deep-equal AND byte for byte (the same
 * document bp's scripts/brief-golden.ts writes). When bp changes the brief, its golden changes in the same commit
 * (bp's check:decision-brief refuses otherwise); re-copy the golden, update GOLDEN_PIN, and this goes red until the
 * port follows. The pins are also what bp's cross-repo drift report reads (ROADMAP E5).
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import goldenRaw from '../standard/decision-brief.golden.json?raw';
import briefSource from '../model/brief.ts?raw';
import { BRIEF_LINES, BRIEF_WIDTH, briefAdvice, briefFor, briefMapOf, repeatNote, subjectOf, type Brief, type BriefSubject } from '../model/brief';
import { emptyScan, type Pack, type Proposal, type Run } from '@/lib/lensScan/wire';

/** bp's golden as copied: its path in bp, the bp commit it was copied at, and the sha256 of its LF bytes. */
const GOLDEN_PIN = {
  path: 'docs/concepts/decision-brief/golden.json',
  commit: '51e193e',
  sha256: '24174161fab145ba1836bebfa35c7a4751145f65608ef6bce4675ac3005cb9d7',
} as const;
/** The port's header: bp's path, the commit and the sha256 of bp's file there. */
const PORT_PIN = /^\/\/ PORTED from bp packages\/core\/src\/scan\/brief\.ts @ ([0-9a-f]{7,40}) sha256:([0-9a-f]{64})$/m;

interface GoldenCase { name: string; subject: BriefSubject; brief: Brief }
interface Golden {
  note: string;
  inputs: { map: unknown; scan: { runs: Run[]; packs: Pack[]; proposals: Proposal[] } };
  cases: GoldenCase[];
}

const lf = (t: string) => t.replace(/\r\n/g, '\n');
// Invariant that makes this cast safe: the file is bp's golden.json copied byte for byte (the sha256 test below holds
// it), and bp writes it from typed values (scripts/brief-golden.ts: the map, Run[], Pack[], Proposal[], Brief).
const golden = JSON.parse(lf(goldenRaw)) as Golden;
const scan = { ...emptyScan(), ...golden.inputs.scan };
const map = briefMapOf(golden.inputs.map);

describe('the decision brief port, held by bp golden', () => {
  it('is the golden bp pinned (sha256 of the copied file)', () => {
    expect(createHash('sha256').update(lf(goldenRaw)).digest('hex')).toBe(GOLDEN_PIN.sha256);
    expect(golden.cases).toHaveLength(6);
  });

  it('names the bp commit and file hash it was ported from, the same commit as the golden', () => {
    const m = PORT_PIN.exec(briefSource);
    expect(m, 'brief.ts header must be "// PORTED from bp packages/core/src/scan/brief.ts @ <sha> sha256:<hash>"').not.toBeNull();
    expect(m![1]).toBe(GOLDEN_PIN.commit);
  });

  for (const c of golden.cases) {
    it(`reproduces "${c.name}" deep-equal`, () => {
      expect(briefFor(c.subject, scan, map)).toEqual(c.brief);
    });
  }

  it('reproduces the whole document byte for byte, as bp scripts/brief-golden.ts writes it', () => {
    const cases = golden.cases.map(({ name, subject }) => ({ name, subject, brief: briefFor(subject, scan, map) }));
    const doc = JSON.stringify({ note: golden.note, inputs: golden.inputs, cases }, null, 2) + '\n';
    expect(doc).toBe(lf(goldenRaw));
  });
});

describe('what the card reads off the brief', () => {
  const caseOf = (name: string) => golden.cases.find((c) => c.name === name)!;
  const rowOf = (id: string) => scan.proposals.find((p) => p.id === id)!;

  it('builds the subject from a v4 store row: tier and risk_class reach the brief', () => {
    const row = rowOf('o2');
    expect(subjectOf(row)).toEqual(caseOf('a repeat of a decline').subject);
    const b = briefFor(subjectOf(row), scan, map);
    expect(b.reversible).toEqual({ approve: 'until-triage', decline: 'final', afterRelease: 'care', riskClass: 'money' });
    expect(b.facts.find((f) => f.key === 'precedent')?.text).toContain('tier 2');
  });

  it('a v3 row (no tier, no risk_class) says the risk class is unknown, never guesses', () => {
    const { tier: _t, risk_class: _r, ...v3 } = rowOf('o2');
    const b = briefFor(subjectOf(v3), scan, map);
    expect(b.reversible.afterRelease).toBe('unknown');
    expect(b.facts.find((f) => f.key === 'undo')?.text).toContain('unknown (no risk class)');
  });

  it('a repeat says withdraw, and its decline note names the decision it repeats', () => {
    const b = caseOf('a repeat of a decline').brief;
    expect(b.advice.say).toBe('withdraw');
    expect(repeatNote(b.declines[0]!)).toBe('Repeats h4, declined 2026-10-10: "No retries until idempotency keys land."');
  });

  it('a like idea elsewhere asks, never flips, and still quotes the decline', () => {
    const b = caseOf('a like idea declined elsewhere (asks, never flips)').brief;
    expect(b.advice.say).toBe('ask');
    expect(b.declines.length).toBeGreaterThan(0);
  });

  it('the live advice agrees with the full brief on every case', () => {
    for (const c of golden.cases) expect(briefAdvice(c.subject, scan).say).toBe(c.brief.advice.say);
  });

  it('keeps every brief inside the shared line budget', () => {
    for (const c of golden.cases) {
      expect(c.brief.facts.length).toBeLessThanOrEqual(BRIEF_LINES);
      for (const l of c.brief.lines) expect(l.length).toBeLessThanOrEqual(BRIEF_WIDTH);
    }
  });
});
