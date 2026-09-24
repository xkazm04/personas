// Shared test fixtures for the Contest engine (also handy for WP5 shells).
import type { ContestDetail } from '@/lib/bindings/ContestDetail';
import type { ContestSummary } from '@/lib/bindings/ContestSummary';

export function summaryFixture(over: Partial<ContestSummary> = {}): ContestSummary {
  return {
    projectId: 'p1',
    projectName: 'Personas',
    contestId: 'hero-page',
    title: 'Hero page',
    date: '2026-09-24',
    phase: 'review',
    seatCount: 2,
    variantsPerSeat: 2,
    seatSpecs: ['claude:claude-opus-5-5@xhigh', 'codex:gpt-6-sol@high'],
    winner: null,
    winnerSeatSpec: null,
    shortlist: [],
    parentId: null,
    round: null,
    updatedAtMs: 1_758_700_000_000,
    ...over,
  };
}

export function detailFixture(over: Partial<ContestDetail> = {}): ContestDetail {
  return {
    summary: summaryFixture(),
    brief: '## The idea\nA hero page.',
    arenaPath: 'C:/p1/.contest/arena/hero-page',
    judgesEnabled: false,
    judges: [],
    notBeforeMs: null,
    seats: [
      {
        seatId: 'claude-claude-opus-5-5_xhigh',
        spec: 'claude:claude-opus-5-5@xhigh',
        kind: 'participant',
        state: 'completed',
        fleetSessionId: 'fs-1',
        letter: 'A',
        wallS: 1240,
        costUsd: 3.21,
        turns: 40,
        errors: [],
      },
      {
        seatId: 'codex-gpt-6-sol_high',
        spec: 'codex:gpt-6-sol@high',
        kind: 'participant',
        state: 'seat-limit',
        fleetSessionId: null,
        letter: 'B',
        wallS: null,
        costUsd: null,
        turns: null,
        errors: ['usage limit reached'],
      },
    ],
    variants: [
      {
        key: 'A/1',
        letter: 'A',
        seatId: 'claude-claude-opus-5-5_xhigh',
        n: 1,
        present: true,
        title: 'Planetarium',
        concept: 'A dome of stars',
        bytes: 48_000,
        hasNotes: true,
        previewUrl: 'http://127.0.0.1:1/contest-preview/t/p1/hero-page/entries/a/variant-1/index.html',
        screenshots: [],
      },
      {
        key: 'B/1',
        letter: 'B',
        seatId: 'codex-gpt-6-sol_high',
        n: 1,
        present: true,
        title: 'Grid',
        concept: 'Swiss grid',
        bytes: 12_000,
        hasNotes: false,
        previewUrl: null,
        screenshots: [],
      },
    ],
    scoreboard: null,
    review: null,
    chain: { step: 'ready', reason: null, updatedAtMs: null },
    ...over,
  };
}
