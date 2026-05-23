import { describe, expect, it } from 'vitest';
import { parseDigest } from '../parseDigest';

describe('parseDigest', () => {
  it('returns an empty list for an empty digest', () => {
    expect(parseDigest('')).toEqual([]);
    expect(parseDigest('\n  \n')).toEqual([]);
  });

  it('parses a single op with no sessions', () => {
    const digest = [
      '## Active orchestration (operative memory)',
      '- **Wire up the dispatcher** (`op_abc12`, dispatched, started 12s ago)',
    ].join('\n');
    const ops = parseDigest(digest);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({
      intent: 'Wire up the dispatcher',
      id8: 'op_abc12',
      status: 'dispatched',
      duration: 'started 12s ago',
      sessions: [],
    });
  });

  it('parses an op with one fully-detailed session', () => {
    const digest = [
      '## Active orchestration (operative memory)',
      '- **Ship the gate fix** (`op_def34`, in flight, started 3m ago)',
      '  - `sess_aa11` "reviewer": editing → grep',
      '    intent: find the gate predicate',
      '    checkpoint: grep done · blockers: not yet narrowed to file',
      '    files: src/a.rs, src/b.rs (+2 more)',
      '    ⚠ recent failure: search returned >500 matches',
      '    summary: narrowing search to engine/',
    ].join('\n');
    const ops = parseDigest(digest);
    expect(ops).toHaveLength(1);
    expect(ops[0].sessions).toHaveLength(1);
    const sess = ops[0].sessions[0];
    expect(sess).toMatchObject({
      id8: 'sess_aa11',
      role: 'reviewer',
      state: 'editing',
      tool: 'grep',
      intent: 'find the gate predicate',
      checkpoint: 'grep done',
      blockers: 'not yet narrowed to file',
      files: ['src/a.rs', 'src/b.rs'],
      filesMore: 2,
      failure: 'search returned >500 matches',
      summary: 'narrowing search to engine/',
    });
  });

  it('handles a session with no role and no tool', () => {
    const digest = [
      '- **Quick task** (`op_xyz99`, queued, started 5s ago)',
      '  - `sess_bb22`: waiting_for_user',
    ].join('\n');
    const ops = parseDigest(digest);
    expect(ops[0].sessions[0]).toMatchObject({
      id8: 'sess_bb22',
      role: undefined,
      state: 'waiting_for_user',
      tool: undefined,
    });
  });

  it('parses multiple ops, each with multiple sessions, preserving order', () => {
    const digest = [
      '- **Op One** (`op_11111111`, in flight, started 1m ago)',
      '  - `sess_a`: editing',
      '  - `sess_b`: reviewing',
      '- **Op Two** (`op_22222222`, in flight, started 30s ago)',
      '  - `sess_c`: editing',
    ].join('\n');
    const ops = parseDigest(digest);
    expect(ops.map((o) => o.id8)).toEqual(['op_11111111', 'op_22222222']);
    expect(ops[0].sessions.map((s) => s.id8)).toEqual(['sess_a', 'sess_b']);
    expect(ops[1].sessions.map((s) => s.id8)).toEqual(['sess_c']);
  });

  it('parses a checkpoint without blockers', () => {
    const digest = [
      '- **Test op** (`op_33333333`, in flight, started 10s ago)',
      '  - `sess_d`: editing',
      '    checkpoint: applied the refactor cleanly',
    ].join('\n');
    const sess = parseDigest(digest)[0].sessions[0];
    expect(sess.checkpoint).toBe('applied the refactor cleanly');
    expect(sess.blockers).toBeUndefined();
  });

  it('parses a files line with no "more" trailer', () => {
    const digest = [
      '- **Test op** (`op_44444444`, in flight, started 10s ago)',
      '  - `sess_e`: editing',
      '    files: src/x.ts',
    ].join('\n');
    const sess = parseDigest(digest)[0].sessions[0];
    expect(sess.files).toEqual(['src/x.ts']);
    expect(sess.filesMore).toBeUndefined();
  });

  it('ignores trailing reference lines after all ops', () => {
    const digest = [
      '- **Op** (`op_55555555`, in flight, started 10s ago)',
      '',
      'Reference operations by their id (`op_xxx`) or session id prefix.',
    ].join('\n');
    const ops = parseDigest(digest);
    expect(ops).toHaveLength(1);
    expect(ops[0].sessions).toEqual([]);
  });

  it('returns an empty list when parser cannot find any op header (format drift)', () => {
    const digest = [
      '## Some other format the backend changed to',
      'random text',
      'more random text',
    ].join('\n');
    expect(parseDigest(digest)).toEqual([]);
  });
});
