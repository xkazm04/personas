import { describe, expect, it } from 'vitest';
import { classifySystemNote } from '../chat/athenaChatSystemKind';
import { systemMarkerOf } from '../systemMarkers';

const LABELS = { dispatcher: 'Action blocked', fleetOp: 'Fleet operation', plain: 'Note' };

describe('systemMarkerOf', () => {
  it('recognises the three provenance markers', () => {
    expect(systemMarkerOf('[autonomous continuation #3]')).toBe('autonomous');
    expect(systemMarkerOf('[Fleet]')).toBe('fleet');
    expect(systemMarkerOf('  [proactive: incident_blocker]')).toBe('proactive');
  });

  it('leaves real content alone', () => {
    expect(systemMarkerOf('[dispatcher] Your last OP was rejected')).toBeNull();
    expect(systemMarkerOf('The action completed.')).toBeNull();
    // `[fleet…]` must match on a word boundary, not any bracket starting "fleet".
    expect(systemMarkerOf('[fleetwide] something else')).toBeNull();
  });
});

describe('classifySystemNote', () => {
  it('splits a fleet-orchestration record into a summary plus its correlators', () => {
    const note = classifySystemNote(
      'fleet-orchestration op:abcdef1234567890 state:op_completed intent:ship the milestone\n\n' +
        'Three sessions landed; one needs review.',
      LABELS,
    );
    expect(note.kind).toBe('fleet_op');
    expect(note.label).toBe('Fleet operation');
    expect(note.body).toBe('Three sessions landed; one needs review.');
    // The op id is truncated — it identifies, it isn't meant to be read.
    expect(note.meta).toBe('op_completed · op abcdef12');
  });

  it('falls back to the intent when an operation record carries no summary', () => {
    const note = classifySystemNote(
      'fleet-orchestration op:xyz state:op_active intent:audit the vault',
      LABELS,
    );
    expect(note.body).toBe('audit the vault');
  });

  it('names a dispatcher rejection and drops its tag from the body', () => {
    const note = classifySystemNote(
      '[dispatcher] Your last `OP: use_connector{gmail, send}` was rejected. Reason: not pinned.',
      LABELS,
    );
    expect(note.kind).toBe('dispatcher');
    expect(note.label).toBe('Action blocked');
    expect(note.body.startsWith('Your last')).toBe(true);
  });

  it('title-cases an unrecognised tag rather than inventing a name for it', () => {
    const note = classifySystemNote('[skill_run] Finished /scan-sweep on api.', LABELS);
    expect(note.kind).toBe('tagged');
    expect(note.label).toBe('Skill run');
    expect(note.body).toBe('Finished /scan-sweep on api.');
  });

  it('treats untagged prose as a plain note', () => {
    const note = classifySystemNote('The approval was granted.', LABELS);
    expect(note).toEqual({
      kind: 'plain',
      label: 'Note',
      body: 'The approval was granted.',
    });
  });

  it('preserves markdown in the body — the whole point of the redesign', () => {
    const note = classifySystemNote(
      '[dispatcher] Blocked:\n\n- `gmail` is not pinned\n- `slack` is disabled\n',
      LABELS,
    );
    expect(note.body).toContain('- `gmail` is not pinned');
    expect(note.body).toContain('- `slack` is disabled');
  });
});
