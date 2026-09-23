import { describe, it, expect } from 'vitest';
import {
  initialArtifactJobState,
  stepArtifactJob,
  artifactDeadlineMs,
  readJobId,
  type ArtifactJobConfig,
  type ArtifactJobInput,
} from '../artifactJobCorrelator';
import { buildResolveStatus } from '../../template/useAiArtifactFlow';

// The correlator is pure: (state, input) -> state + commands. These tests fold
// the commands into the same view the driver (useTauriStream) keeps, so a case
// reads as "what the user would see", not as a command list.

const CFG: ArtifactJobConfig = { idField: 'design_id', initialStatus: 'analyzing' };
const resolve = buildResolveStatus<Record<string, unknown>>('Credential design failed');

interface View {
  phase: 'running' | 'completed' | 'error';
  lines: string[];
  result: Record<string, unknown> | null;
  errorKind: string | null;
  cancels: number;
}

function run(inputs: ArtifactJobInput[], cfg: ArtifactJobConfig = CFG) {
  let state = initialArtifactJobState(cfg);
  const view: View = { phase: 'running', lines: [], result: null, errorKind: null, cancels: 0 };
  for (const input of inputs) {
    const step = stepArtifactJob(state, input, cfg);
    state = step.state;
    for (const cmd of step.commands) {
      switch (cmd.type) {
        case 'line':
          view.lines.push(cmd.payload.line as string);
          break;
        case 'status': {
          const outcome = resolve(cmd.payload);
          if (!outcome) break;
          if ('result' in outcome) {
            view.result = outcome.result;
            view.phase = 'completed';
          } else {
            view.phase = 'error';
            view.errorKind = 'failed';
          }
          break;
        }
        case 'superseded':
          view.phase = 'error';
          view.errorKind = 'superseded';
          break;
        case 'timeout':
          view.phase = 'error';
          view.errorKind = 'timeout';
          break;
        case 'cancelBackend':
          view.cancels += 1;
          break;
      }
    }
  }
  return { state, view };
}

const progress = (id: string, line: string): ArtifactJobInput => ({
  type: 'progress',
  payload: { design_id: id, line },
});
const status = (id: string, s: string, result: unknown = null): ArtifactJobInput => ({
  type: 'status',
  payload: { design_id: id, status: s, result, error: null },
});
const idKnown = (id: string | null): ArtifactJobInput => ({ type: 'idKnown', id });

describe('artifactJobCorrelator', () => {
  it('case 1: a held line from a foreign run is dropped once our id is known', () => {
    const { view } = run([progress('A', 'Connected (x)'), idKnown('B')]);
    expect(view.lines).toEqual([]);
  });

  it('case 2: an early line of our own run is held and replayed, not lost', () => {
    const { view } = run([progress('B', 'Connecting to Claude...'), idKnown('B')]);
    expect(view.lines).toEqual(['Connecting to Claude...']);
  });

  it("case 3: a foreign run's completed status is not taken as our result", () => {
    const { view } = run([
      idKnown('B'),
      status('A', 'completed', { connector: { name: 'from-A' } }),
    ]);
    expect(view.phase).toBe('running');
    expect(view.result).toBeNull();
  });

  it('case 4: a foreign initial status after ours means our run was superseded', () => {
    const { view } = run([idKnown('B'), status('B', 'analyzing'), status('C', 'analyzing')]);
    expect(view.phase).toBe('error');
    expect(view.errorKind).toBe('superseded');
  });

  // -- refinements the four cases above rely on ---------------------------

  it('a foreign initial status held BEFORE ours is the run we replaced, not our replacement', () => {
    const { view } = run([
      status('C', 'analyzing'),
      status('B', 'analyzing'),
      idKnown('B'),
      status('B', 'completed', { ok: true }),
    ]);
    expect(view.phase).toBe('completed');
    expect(view.result).toEqual({ ok: true });
  });

  it('the deadline times the run out and cancels the backend exactly once', () => {
    const { view, state } = run([idKnown('B'), status('B', 'analyzing'), { type: 'deadline' }]);
    expect(view.errorKind).toBe('timeout');
    expect(view.cancels).toBe(1);
    // Over is over: a later deadline or event produces nothing.
    const again = stepArtifactJob(state, { type: 'deadline' }, CFG);
    expect(again.commands).toEqual([]);
  });

  it('the deadline does not cancel when another run was seen in the domain (it may be theirs)', () => {
    const { view } = run([idKnown('B'), progress('Z', 'someone else'), { type: 'deadline' }]);
    expect(view.errorKind).toBe('timeout');
    expect(view.cancels).toBe(0);
  });

  it('a start result with no id falls back to the uncorrelated pass-through', () => {
    const { view } = run([progress('A', 'one'), idKnown(null), progress('Z', 'two')]);
    expect(view.lines).toEqual(['one', 'two']);
  });

  it('no idField configured is today\'s uncorrelated behaviour', () => {
    const cfg: ArtifactJobConfig = { idField: null, initialStatus: 'analyzing' };
    const { view } = run([progress('A', 'one'), status('A', 'completed', { a: 1 })], cfg);
    expect(view.lines).toEqual(['one']);
    expect(view.result).toEqual({ a: 1 });
  });

  it('readJobId reads the id field of the start result, and nothing else', () => {
    expect(readJobId({ design_id: 'B' }, 'design_id')).toBe('B');
    expect(readJobId({ design_id: 7 }, 'design_id')).toBeNull();
    expect(readJobId(undefined, 'design_id')).toBeNull();
    expect(readJobId({ other: 'x' }, 'design_id')).toBeNull();
  });

  it('the frontend deadline is never shorter than the backend timeout', () => {
    for (const secs of [120, 300, 600]) {
      expect(artifactDeadlineMs(secs)).toBeGreaterThanOrEqual(secs * 1000);
    }
  });
});
