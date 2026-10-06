/**
 * The headless App Master chip on an Orchestration row: a project run from a
 * terminal (`/appmaster`) reads "Headless - running" / "Headless - idle" while
 * its last report is fresh, "Headless - stale" once it is not, and nothing at
 * all when no report was ever posted or the terminal chair ended.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { DispatchPreviewRow } from '@/lib/bindings/DispatchPreviewRow';
import type { HeadlessState } from '@/lib/bindings/HeadlessState';
import { HeadlessChip, PersonaIdentity, headlessChipKind, refusalLabel } from '../parts';
import { en } from '@/i18n/en';

afterEach(cleanup);

function beat(state: string, fresh: boolean): HeadlessState {
  return {
    state,
    note: 'Wake 7. Dispatched the salvage builder.',
    nextWakeAt: '2026-10-06T14:00:00Z',
    beatAt: '2026-10-06T12:00:00Z',
    fresh,
  };
}

function row(headless?: HeadlessState): DispatchPreviewRow {
  return {
    personaId: 'am',
    personaName: 'App Master kp',
    personaIcon: null,
    personaColor: null,
    position: 1,
    enabled: false,
    wakePending: false,
    lastServedAt: null,
    intervalMinutes: 30,
    selfPaced: true,
    appMaster: true,
    charters: 1,
    verdict: { kind: 'disabled' },
    lane: null,
    ...(headless ? { headless } : {}),
  };
}

describe('headlessChipKind', () => {
  it('reads running / idle while fresh, stale after, and nothing without a live chair', () => {
    expect(headlessChipKind(beat('running', true))).toBe('running');
    expect(headlessChipKind(beat('idle', true))).toBe('idle');
    expect(headlessChipKind(beat('running', false))).toBe('stale');
    expect(headlessChipKind(beat('idle', false))).toBe('stale');
    expect(headlessChipKind(beat('ended', false))).toBeNull();
    expect(headlessChipKind(undefined)).toBeNull();
    expect(headlessChipKind(null)).toBeNull();
  });
});

describe('HeadlessChip on the persona identity', () => {
  it('a fresh running beat reads "Headless - running"', () => {
    render(<PersonaIdentity row={row(beat('running', true))} dense />);
    const chip = screen.getByTestId('orchestration-headless-chip');
    expect(chip.dataset.kind).toBe('running');
    expect(chip.textContent).toBe(en.monitor.orch_headless_running);
  });

  it('a fresh idle beat reads "Headless - idle"', () => {
    render(<PersonaIdentity row={row(beat('idle', true))} dense />);
    expect(screen.getByTestId('orchestration-headless-chip').textContent).toBe(en.monitor.orch_headless_idle);
  });

  it('a stale beat reads "Headless - stale"', () => {
    render(<HeadlessChip headless={beat('running', false)} />);
    const chip = screen.getByTestId('orchestration-headless-chip');
    expect(chip.dataset.kind).toBe('stale');
    expect(chip.textContent).toBe(en.monitor.orch_headless_stale);
  });

  it('no beat (and an ended one) renders no chip', () => {
    render(<PersonaIdentity row={row()} dense />);
    expect(screen.queryByTestId('orchestration-headless-chip')).toBeNull();
    cleanup();
    render(<PersonaIdentity row={row(beat('ended', false))} dense />);
    expect(screen.queryByTestId('orchestration-headless-chip')).toBeNull();
  });

  it('never calls it a heartbeat (the Vitals Ledger owns that word)', () => {
    for (const k of [
      'orch_headless_running',
      'orch_headless_idle',
      'orch_headless_stale',
      'orch_headless_hint',
      'orch_refusal_headless',
    ] as const) {
      expect(en.monitor[k].toLowerCase()).not.toContain('heartbeat');
    }
  });
});

describe('refusalLabel', () => {
  it('names the headless stand-aside', () => {
    expect(refusalLabel(en.monitor, 'headless_master')).toBe(en.monitor.orch_refusal_headless);
  });
});
