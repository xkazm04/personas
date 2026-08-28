import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SCORECARD_COMMAND } from '../SubjectDetail';

// The same command string exists on both sides of the FFI boundary: the client
// shows it as the recovery step, and the Rust reader embeds it in the errors it
// returns when the scorecard is missing or unparseable.
//
// It used to be held together by a comment asking the next reader to keep the
// two in agreement. A comment cannot fail a build, so this test is the actual
// mechanism: if either side is edited alone, this goes red naming both files.
const RUST_READER = 'src-tauri/src/commands/infrastructure/hierarchy_read.rs';

describe('SCORECARD_COMMAND', () => {
  it('is byte-identical to SCORECARD_GENERATOR in the Rust reader', () => {
    const rust = readFileSync(RUST_READER, 'utf8');
    const match = rust.match(/const SCORECARD_GENERATOR: &str = "([^"]+)";/);

    expect(
      match,
      `SCORECARD_GENERATOR was not found in ${RUST_READER}. If it was renamed or `
        + 'moved, update this test with it — do not delete the assertion.',
    ).not.toBeNull();

    expect(match?.[1]).toBe(SCORECARD_COMMAND);
  });
});
