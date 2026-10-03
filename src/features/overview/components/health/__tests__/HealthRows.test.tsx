/**
 * The shared check list of all three prototypes (kit batch home-3). What is asserted is what the
 * owner's note is about: the row's metadata SPREADS into declared columns instead of stacking
 * under the name, status is the Mark on the spine rather than a word in a column, and a detail
 * string can never decide a row's height.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import type { HealthCheckItem } from '@/api/system/system';
import type { HealthCheckStatus } from '@/lib/bindings/HealthCheckStatus';

import { HealthRows, rowKey, sortRowsBySeverity, type HealthRow } from '../HealthRows';
import type { HealthActionDeps } from '../HealthActions';

// Fixture: the installer state the actions read, with only the fields they touch.
const idle = { phase: 'idle', progressPct: 0, outputLines: [], error: null, manualCommand: null } as unknown as HealthActionDeps['nodeState'];

const deps: HealthActionDeps = {
  unavailable: false,
  nodeState: idle,
  claudeState: idle,
  install: vi.fn(),
  authLoading: false,
  authError: null,
  onSignIn: vi.fn(),
  onShowOllama: vi.fn(),
  onShowLiteLLM: vi.fn(),
  onMcpDone: vi.fn(),
};

const item = (id: string, status: HealthCheckStatus, extra: Partial<HealthCheckItem> = {}): HealthCheckItem =>
  ({ id, label: id, status, detail: null, installable: false, ...extra });

const row = (sectionId: HealthRow['sectionId'], it: HealthCheckItem): HealthRow => ({ sectionId, item: it });

describe('HealthRows', () => {
  it('spreads the detail into a declared column and keeps the row at the fixed step', () => {
    render(
      <HealthRows
        label="checks"
        deps={deps}
        rows={[row('local', item('disk', 'warn', { detail: '6.2 GB free on C:' }))]}
      />,
    );
    const rows = document.querySelectorAll('[data-kit="ListRow"]');
    expect(rows).toHaveLength(1);
    // The 48px step, not a height the detail string decided (Gate 2b).
    expect(rows[0]?.className).toContain('k-row--s');
    // One declared track set on the LIST, which is what makes the columns line up.
    expect(document.querySelector('.k-rowcols')).toBeTruthy();
    expect(screen.getByText('6.2 GB free on C:')).toBeInTheDocument();
  });

  it('carries status as the Mark on the spine, never as a Status column', () => {
    render(<HealthRows label="checks" deps={deps} rows={[row('local', item('disk', 'error'))]} />);
    const mark = document.querySelector('[data-kit="ListRow"] .k-mark');
    expect(mark?.className).toContain('t-error');
    // The head line declares Check / Detail / Action and nothing else.
    const heads = Array.from(document.querySelectorAll('.k-rowhead > span')).map((s) => s.textContent);
    expect(heads.filter(Boolean)).toEqual(['Check', 'Detail', 'Action']);
  });

  it('adds the environment column only where the list spans every environment', () => {
    render(<HealthRows label="checks" deps={deps} showSection rows={[row('agents', item('ollama_api_key', 'inactive'))]} />);
    const heads = Array.from(document.querySelectorAll('.k-rowhead > span')).map((s) => s.textContent);
    expect(heads.filter(Boolean)).toEqual(['Check', 'Environment', 'Detail', 'Action']);
  });

  it('an empty list is the success band, because that is prototype C\'s whole argument', () => {
    render(<HealthRows label="checks" deps={deps} rows={[]} />);
    expect(screen.getByText('Nothing needs your attention')).toBeInTheDocument();
    expect(document.querySelector('[data-kit="ListRow"]')).toBeNull();
  });

  it('offers the action of a check that has one, and nothing for a check that does not', () => {
    render(
      <HealthRows
        label="checks"
        deps={deps}
        rows={[
          row('agents', item('ollama_api_key', 'inactive')),
          row('local', item('db_writable', 'ok')),
        ]}
      />,
    );
    expect(screen.getAllByRole('button', { name: 'Configure' })).toHaveLength(1);
  });

  it('offers no action at all when the bridge is down', () => {
    render(
      <HealthRows
        label="checks"
        deps={{ ...deps, unavailable: true }}
        rows={[row('agents', item('ollama_api_key', 'inactive'))]}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Configure' })).toBeNull();
  });
});

describe('sortRowsBySeverity', () => {
  it('puts the work first so a capped list can never hide a failure', () => {
    const rows = [
      row('local', item('ok-one', 'ok')),
      row('cloud', item('fact', 'info')),
      row('environment', item('broken', 'error')),
      row('agents', item('setup', 'inactive')),
    ];
    expect(sortRowsBySeverity(rows).map((r) => r.item.id)).toEqual(['broken', 'setup', 'fact', 'ok-one']);
  });

  it('keys a row by its environment AND its check, since ids repeat across sections', () => {
    expect(rowKey(row('local', item('environment', 'ok')))).toBe('local/environment');
    expect(rowKey(row('environment', item('environment', 'ok')))).toBe('environment/environment');
  });
});
