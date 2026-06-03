import { describe, it, expect } from 'vitest';
import { standardsCompliance } from '../../scripts/test/lib/eval/standards.mjs';

// Mirrors tests/cli/resilience.test.mjs — unit-tests the pure §7 scorer against
// synthetic standards_config + signal fixtures. The scorer reuses signals
// evaluate.mjs already computes (codeTrack, docChanged, delivered increment);
// here we feed them directly.

const cfg = (over = {}) => ({
  precommit: { lint: true, docs_required: true, code_quality: true },
  branching: { pr_base: 'main', automerge: { enabled: false, target: 'main' } },
  ...over,
});
const ct = (over = {}) => ({ build: { status: 'pass' }, lint: { status: 'pass' }, test: { status: 'pass' }, ...over });
const delivered = { delivered: true };
const undelivered = { delivered: false, reason: 'master did not advance' };

describe('standardsCompliance — strict no-op (golden-safe)', () => {
  it('returns null for a doc-track run (isCodeTrack false)', () => {
    expect(standardsCompliance({ standardsConfig: cfg(), isCodeTrack: false, codeTrack: ct(), docChanged: true, increment: delivered })).toBeNull();
  });
  it('returns null when the project has no standards_config', () => {
    expect(standardsCompliance({ standardsConfig: null, isCodeTrack: true, codeTrack: ct(), docChanged: true, increment: delivered })).toBeNull();
  });
});

describe('standardsCompliance — full compliance', () => {
  it('all gates pass + docs touched + merged to main → pct 100, no fail rules', () => {
    const r = standardsCompliance({ standardsConfig: cfg(), isCodeTrack: true, codeTrack: ct(), docChanged: true, increment: delivered });
    expect(r.applicable).toBe(true);
    expect(r.pct).toBe(100);
    expect(r.rules.filter((x) => x.status === 'fail')).toEqual([]);
    // lint + code_quality + docs_required + pr_base = 4 scored rules
    expect(r.rules.filter((x) => x.status === 'pass').length).toBe(4);
  });
});

describe('standardsCompliance — violations cap below 100', () => {
  it('policy requires lint but lint failed → that rule fails, pct < 100', () => {
    const r = standardsCompliance({ standardsConfig: cfg(), isCodeTrack: true, codeTrack: ct({ lint: { status: 'fail' } }), docChanged: true, increment: delivered });
    const lint = r.rules.find((x) => x.id === 'precommit.lint');
    expect(lint.status).toBe('fail');
    expect(r.pct).toBeLessThan(100);
  });

  it('policy requires docs but none touched → docs_required fails', () => {
    const r = standardsCompliance({ standardsConfig: cfg(), isCodeTrack: true, codeTrack: ct(), docChanged: false, increment: delivered });
    expect(r.rules.find((x) => x.id === 'precommit.docs_required').status).toBe('fail');
    expect(r.pct).toBeLessThan(100);
  });

  it('pr_base main but increment not delivered → branching.pr_base fails', () => {
    const r = standardsCompliance({ standardsConfig: cfg(), isCodeTrack: true, codeTrack: ct(), docChanged: true, increment: undelivered });
    expect(r.rules.find((x) => x.id === 'branching.pr_base').status).toBe('fail');
    expect(r.pct).toBeLessThan(100);
  });
});

describe('standardsCompliance — gates only scored when required', () => {
  it('all precommit gates off → those rules absent; only branching scored', () => {
    const r = standardsCompliance({
      standardsConfig: cfg({ precommit: { lint: false, docs_required: false, code_quality: false } }),
      isCodeTrack: true,
      codeTrack: ct({ lint: { status: 'fail' }, build: { status: 'fail' } }),
      docChanged: false,
      increment: delivered,
    });
    expect(r.rules.find((x) => x.id === 'precommit.lint')).toBeUndefined();
    expect(r.rules.find((x) => x.id === 'precommit.code_quality')).toBeUndefined();
    expect(r.rules.find((x) => x.id === 'precommit.docs_required')).toBeUndefined();
    // only branching.pr_base (main, delivered) → pass → pct 100
    expect(r.pct).toBe(100);
  });
});

describe('standardsCompliance — informational na rules never fail', () => {
  it("pr_base 'test' is reported na (not locally observable), not a fail", () => {
    const r = standardsCompliance({
      standardsConfig: cfg({ branching: { pr_base: 'test', automerge: { enabled: true, target: 'test' } } }),
      isCodeTrack: true,
      codeTrack: ct(),
      docChanged: true,
      increment: undelivered, // would fail for 'main', but base is 'test'
    });
    const base = r.rules.find((x) => x.id === 'branching.pr_base');
    expect(base.status).toBe('na');
    expect(r.rules.find((x) => x.id === 'branching.automerge').status).toBe('na');
    // lint + code_quality + docs_required all pass → pct 100 (na rules excluded)
    expect(r.pct).toBe(100);
  });

  it('code_quality with all-na codeTrack (no commands) → na, excluded from pct', () => {
    const r = standardsCompliance({
      standardsConfig: cfg({ precommit: { lint: false, docs_required: false, code_quality: true } }),
      isCodeTrack: true,
      codeTrack: { build: { status: 'na' }, lint: { status: 'na' }, test: { status: 'na' } },
      docChanged: false,
      increment: delivered,
    });
    expect(r.rules.find((x) => x.id === 'precommit.code_quality').status).toBe('na');
  });
});

describe('standardsCompliance — purity', () => {
  it('does not mutate inputs and is deterministic', () => {
    const sc = cfg();
    const snap = JSON.stringify(sc);
    const a = standardsCompliance({ standardsConfig: sc, isCodeTrack: true, codeTrack: ct(), docChanged: true, increment: delivered });
    const b = standardsCompliance({ standardsConfig: sc, isCodeTrack: true, codeTrack: ct(), docChanged: true, increment: delivered });
    expect(a).toEqual(b);
    expect(JSON.stringify(sc)).toBe(snap);
  });
});
