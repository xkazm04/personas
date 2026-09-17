/**
 * `HealthProbeState::Unreachable` is documented in the backend as NOT a
 * verdict: the probe never reached the service, so it says nothing about the
 * credential. The frontend resolver recognised three tokens and not that one,
 * so an `unreachable` token on the wire fell through to the legacy
 * `healthcheck_last_success` boolean — painting an offline laptop's good keys
 * as Ready or Broken depending on which way the boolean happened to sit.
 */
import { describe, it, expect } from 'vitest';
import {
  readCredentialHealthState,
  isCredentialVerified,
  isHealthVerdict,
} from '../healthState';

function cred(state: string | null, lastSuccess: boolean | null) {
  return {
    metadata: state === null ? null : JSON.stringify({ healthcheck_last_state: state }),
    healthcheck_last_success: lastSuccess,
  };
}

describe('readCredentialHealthState', () => {
  it('recognises the unreachable token instead of falling through to the boolean', () => {
    // The boolean says "passed yesterday"; the token says "could not check
    // today". Before the fix this returned `verified`.
    expect(readCredentialHealthState(cred('unreachable', true))).toBe('unreachable');
    // And the mirror case, which used to read as a hard failure.
    expect(readCredentialHealthState(cred('unreachable', false))).toBe('unreachable');
  });

  it('still reads the three verdict tokens', () => {
    expect(readCredentialHealthState(cred('verified', null))).toBe('verified');
    expect(readCredentialHealthState(cred('unverifiable', null))).toBe('unverifiable');
    expect(readCredentialHealthState(cred('failed', null))).toBe('failed');
  });

  it('falls back to the legacy boolean when no token is stored', () => {
    expect(readCredentialHealthState(cred(null, null))).toBe('untested');
    expect(readCredentialHealthState(cred(null, true))).toBe('verified');
    expect(readCredentialHealthState(cred(null, false))).toBe('failed');
  });

  it('never reports unreachable as verified', () => {
    expect(isCredentialVerified(cred('unreachable', true))).toBe(false);
  });

  it('classifies unreachable and untested as non-verdicts', () => {
    expect(isHealthVerdict('unreachable')).toBe(false);
    expect(isHealthVerdict('untested')).toBe(false);
    expect(isHealthVerdict('verified')).toBe(true);
    expect(isHealthVerdict('unverifiable')).toBe(true);
    expect(isHealthVerdict('failed')).toBe(true);
  });
});
