import { describe, expect, it } from 'vitest';

import { projectIdFromDispatchKey } from '../useAutoRescanOnFleetExit';

// The dispatch-key grammar the auto-rescan watcher relies on. All three
// producers (passportDispatchKey, onboardDispatchKey, ShipDispatch) put the
// project id last; anything else must parse to null so a random fleet
// session can never trigger a passport rescan.
describe('projectIdFromDispatchKey', () => {
  it('extracts the project id from unified-row keys', () => {
    expect(projectIdFromDispatchKey('passport:tests:my-project')).toBe('my-project');
    expect(projectIdFromDispatchKey('passport:security:0a1b2c3d')).toBe('0a1b2c3d');
  });

  it('extracts the project id from onboard keys', () => {
    expect(projectIdFromDispatchKey('passport:onboard:my-project')).toBe('my-project');
  });

  it('extracts the project id from ship-criterion keys', () => {
    expect(projectIdFromDispatchKey('passport:ship-tests_green:proj-42')).toBe('proj-42');
  });

  it('rejects non-passport session names', () => {
    expect(projectIdFromDispatchKey('cockpit:bench:foo')).toBeNull();
    expect(projectIdFromDispatchKey('my terminal')).toBeNull();
    expect(projectIdFromDispatchKey(null)).toBeNull();
    expect(projectIdFromDispatchKey(undefined)).toBeNull();
    expect(projectIdFromDispatchKey('')).toBeNull();
  });

  it('rejects malformed passport keys (fewer than 3 segments or empty id)', () => {
    expect(projectIdFromDispatchKey('passport:orphan')).toBeNull();
    expect(projectIdFromDispatchKey('passport:tests:')).toBeNull();
  });
});
