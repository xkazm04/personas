// The inbox's incident status tables must match the Rust vocabulary. The
// tokens are read from the Rust source at run time (as_str arms of
// IncidentStatus, and the portfolio pending-count SQL that defines "still
// awaiting a person"), so a new or renamed status fails here.
// Lives under __tests__/, which tsc skips (node:fs).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OPEN_INCIDENT_STATUSES } from '@/features/decision-center/roster/decisionAdapters';
import {
  ACTIVE_INCIDENT_STATUSES,
  INCIDENT_STATUSES,
  incidentRowActions,
  incidentStateRank,
  isActiveIncidentStatus,
  isClosedIncidentStatus,
} from '../incidentStatus';

const ROOT = resolve(__dirname, '../../../../../..');

function stripRustComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

function rustStatusTokens(): string[] {
  const src = stripRustComments(
    readFileSync(resolve(ROOT, 'src-tauri/core/src/models/audit_incident.rs'), 'utf8'),
  );
  const impl = src.match(/impl IncidentStatus \{[\s\S]*?pub fn as_str[\s\S]*?match self \{([\s\S]*?)\}/);
  expect(impl, 'IncidentStatus::as_str not found').not.toBeNull();
  return [...impl![1]!.matchAll(/IncidentStatus::\w+\s*=>\s*"([a-z_]+)"/g)].map((m) => m[1]!);
}

function rustPendingStatuses(): string[] {
  const src = stripRustComments(
    readFileSync(resolve(ROOT, 'src-tauri/db/src/repos/dev/portfolio.rs'), 'utf8'),
  );
  const sql = src.match(/FROM audit_incidents\s+WHERE status IN \(([^)]*)\)/);
  expect(sql, 'portfolio pending-count SQL not found').not.toBeNull();
  return [...sql![1]!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
}

describe('incident status vocabulary parity', () => {
  it('lists exactly the Rust IncidentStatus tokens', () => {
    const rust = rustStatusTokens();
    expect(rust.length).toBe(5);
    expect([...INCIDENT_STATUSES].sort()).toEqual([...rust].sort());
  });

  it('active set matches the backend pending count and the Decision Deck', () => {
    expect([...ACTIVE_INCIDENT_STATUSES].sort()).toEqual(rustPendingStatuses().sort());
    expect([...ACTIVE_INCIDENT_STATUSES].sort()).toEqual([...OPEN_INCIDENT_STATUSES].sort());
  });

  it('every status is exactly one of active or closed; unknown tokens are neither', () => {
    for (const s of INCIDENT_STATUSES) {
      expect(isActiveIncidentStatus(s) !== isClosedIncidentStatus(s)).toBe(true);
    }
    expect(isActiveIncidentStatus('inprogress')).toBe(false);
    expect(isClosedIncidentStatus('inprogress')).toBe(false);
    expect(incidentStateRank('inprogress')).toBe(9);
  });

  it('a ledger row offers resolve and dismiss for every active status', () => {
    for (const s of ACTIVE_INCIDENT_STATUSES) {
      expect(incidentRowActions(s)).toMatchObject({ resolve: true, dismiss: true, reopen: false });
    }
    expect(incidentRowActions('open').acknowledge).toBe(true);
    expect(incidentRowActions('in_progress').acknowledge).toBe(false);
    expect(incidentRowActions('resolved')).toEqual({ acknowledge: false, resolve: false, dismiss: false, reopen: true });
  });
});
