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
    expect(systemMarkerOf('[fleetwide] something else')).toBeNull();
  });

  // The regression this anchoring exists for. The live DB holds 6 of these and
  // every one was being rendered as a caption-sized divider LABEL — a whole
  // multi-sentence report reduced to chrome, with a stray `]` on the front.
  it('a fleet tag followed by prose is CONTENT, not a marker', () => {
    const real =
      '[Fleet] athena-scan-sweep finished — No pending question — the scan-sweep ran ' +
      'end to end without needing input. Current phase is simply "done and idle".';
    expect(systemMarkerOf(real)).toBeNull();
    // …and it must classify as a readable note instead.
    const note = classifySystemNote(real, LABELS);
    expect(note.kind).toBe('tagged');
    expect(note.label).toBe('Fleet');
    expect(note.body.startsWith('athena-scan-sweep finished')).toBe(true);
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

  // 259 rows of this shape live; the original regex matched only the
  // `fleet-orchestration` shape, of which there are ZERO.
  it('strips the correlator line of a fleet-event row into meta', () => {
    const note = classifySystemNote(
      'fleet-event session:d1cccd9f-4a2b-4c1e-9f10-aa0b1c2d3e4f cc:c84915f4-1111-2222-3333-444455556666 state:exited_failed project:personas',
      LABELS,
    );
    expect(note.kind).toBe('fleet_op');
    expect(note.label).toBe('Fleet operation');
    // No prose follows the correlator line, so the body is empty and the whole
    // line lives in meta — with ids shortened, because they identify, not inform.
    expect(note.body).toBe('');
    expect(note.meta).toContain('state exited_failed');
    expect(note.meta).toContain('project personas');
    expect(note.meta).toContain('session d1cccd9f…');
    expect(note.meta).not.toContain('d1cccd9f-4a2b');
  });

  it('keeps prose that follows a fleet-event correlator line', () => {
    const note = classifySystemNote(
      'fleet-event session:abc state:done project:personas\n\nThe sweep finished cleanly.',
      LABELS,
    );
    expect(note.body).toBe('The sweep finished cleanly.');
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
