/**
 * The Cockpit's lists declare REAL columns (kit grow-4, adopted in batch home-3).
 *
 * Owner, 2026-10-03: "no columns used and creating empty space over passing metadata from rows
 * to spread". Each row used to stack its metadata under its name in one left cell, which left
 * ~1300px of empty band beside it at 1920. These tests pin the three things that fix: the list
 * declares the track set ONCE, every row fills it, and a list whose rows carry nothing to spread
 * keeps the two-cell shape rather than growing an always-empty column.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { useAgentStore } from '@/stores/agentStore';
import { useVaultStore } from '@/stores/vaultStore';
import type { CredentialMetadata } from '@/lib/types/types';
import type { Persona } from '@/lib/bindings/Persona';

import { IssueListWidget } from '../IssueListWidget';
import { TimelineWidget } from '../TimelineWidget';
import { ConnectedServicesWidget } from '../ConnectedServicesWidget';
import { PersonaOverviewWidget } from '../PersonaOverviewWidget';

/** The cells of the first row, in the list's declared order. */
function firstRowCells(): string[] {
  const row = document.querySelector('.k-rows--cols > .k-row')!;
  return Array.from(row.querySelectorAll('.k-row__cell')).map((c) => c.textContent ?? '');
}

const ISSUES = [
  { id: 'i1', title: 'Sentry token expires in 2 days', sublabel: 'Rotate before Thursday', severity: 'warn' },
  { id: 'i2', title: 'Invoice Reconciler failed', sublabel: 'Budget cap reached', severity: 'bad' },
];

describe('IssueListWidget columns', () => {
  it('spreads the sublabel into a Detail column instead of stacking it under the title', () => {
    render(<IssueListWidget title="Needs attention" config={{ items: ISSUES }} />);
    expect(document.querySelector('.k-rowcols')).not.toBeNull();
    // "Detail: " is the sr-only column name the cell carries; the head line itself is aria-hidden.
    expect(firstRowCells()).toEqual(['Detail: Rotate before Thursday']);
    // Fixed row height survives: one line per row, never two (Gate 2b).
    expect(document.querySelector('.k-row')!.className).toContain('k-row--line');
  });

  it('declares no column at all when no item carries a sublabel', () => {
    render(<IssueListWidget title="Needs attention" config={{ items: [{ id: 'a', title: 'Bare' }] }} />);
    expect(document.querySelector('.k-rowcols')).toBeNull();
    expect(document.querySelector('.k-row__cell')).toBeNull();
  });

  it('puts the worst severity on the TILE rail rather than repeating it in text', () => {
    render(<IssueListWidget title="Needs attention" config={{ items: ISSUES }} />);
    const mark = document.querySelector('.k-dtile > .k-mark')!;
    expect(mark.className).toContain('t-error');
  });
});

describe('TimelineWidget columns', () => {
  it('reads as what / what happened / when, all on one row height', () => {
    render(
      <TimelineWidget config={{ events: [
        { label: 'Run stopped', detail: 'Budget cap reached', timestamp: '2026-09-22T02:07:00Z', intent: 'bad' },
      ] }} />,
    );
    expect(firstRowCells()).toEqual(['Detail: Budget cap reached']);
    expect(document.querySelector('.k-row')!.className).toContain('k-row--line');
  });
});

function cred(i: number, ok: boolean | null, message: string | null = null): CredentialMetadata {
  return {
    id: `c-${i}`, name: `Service ${i}`, service_type: 'svc', serviceType: 'svc', metadata: null,
    healthcheck_last_success: ok, healthcheck_last_message: message,
  } as unknown as CredentialMetadata;
}

describe('ConnectedServicesWidget columns', () => {
  beforeEach(() => {
    useAgentStore.setState({ personas: [], fetchPersonas: vi.fn().mockResolvedValue(undefined) } as never);
  });

  it('the probe message is the status cell on a failing row, the health word on a healthy one', () => {
    useVaultStore.setState({
      credentials: [cred(1, false, 'Token expired'), cred(2, true)],
      fetchCredentials: vi.fn().mockResolvedValue(undefined),
    } as never);
    render(<ConnectedServicesWidget config={{}} />);
    const rows = Array.from(document.querySelectorAll('.k-rows--cols > .k-row'));
    expect(rows[0]!.querySelector('.k-row__cell')!.textContent).toContain('Token expired');
    expect(rows[1]!.querySelector('.k-row__cell')!.textContent).not.toContain('Token expired');
  });

  it('a failing vault carries the error on the TILE rail', () => {
    useVaultStore.setState({
      credentials: [cred(1, false, 'Token expired')],
      fetchCredentials: vi.fn().mockResolvedValue(undefined),
    } as never);
    render(<ConnectedServicesWidget config={{}} />);
    expect(document.querySelector('.k-dtile > .k-mark')!.className).toContain('t-error');
  });
});

function persona(over: Partial<Persona>): Persona {
  return {
    id: 'p1', name: 'Persona', enabled: true, trust_score: 0.9, trust_level: 'verified',
    setup_status: 'ready', updated_at: '2026-07-10T00:00:00Z', model_profile: 'claude-sonnet-4-6',
    max_budget_usd: 1, max_turns: 10, description: null, icon: null,
    ...over,
  } as unknown as Persona;
}

describe('PersonaOverviewWidget columns and regions', () => {
  it('the roster spreads description, model, state and trust into aligned columns', () => {
    useAgentStore.setState({
      personas: [
        persona({ id: 'hero', name: 'Incident Commander' }),
        persona({ id: 'p2', name: 'Inbox Triage', description: 'Sorts the morning inbox' }),
      ],
      fetchPersonas: vi.fn().mockResolvedValue(undefined),
    } as never);
    render(<PersonaOverviewWidget title="Your fleet" config={{ hero: 'hero' }} />);
    const cells = firstRowCells();
    expect(cells).toHaveLength(4);
    expect(cells[0]).toContain('Sorts the morning inbox');
    expect(cells[1]).toContain('Sonnet');
    expect(cells[3]).toContain('90%');
    expect(screen.getByText('Inbox Triage')).toBeInTheDocument();
  });

  it('the featured block and the roster are divided regions, not a bare stack of siblings', () => {
    useAgentStore.setState({
      personas: [persona({ id: 'hero' }), persona({ id: 'p2', name: 'Second' })],
      fetchPersonas: vi.fn().mockResolvedValue(undefined),
    } as never);
    render(<PersonaOverviewWidget config={{ hero: 'hero' }} />);
    const stacks = Array.from(document.querySelectorAll('[data-kit="Stack"]'));
    expect(stacks.some((s) => s.className.includes('k-stack--divided'))).toBe(true);
  });
});

describe('DecisionLogWidget columns', () => {
  it('the topic, the choice and the rationale stop being one run-on name', async () => {
    const { DecisionLogWidget } = await import('../DecisionLogWidget');
    render(<DecisionLogWidget config={{ decisions: [
      { label: 'Model tier', choice: 'Sonnet', rationale: 'Line-item reasoning at a nightly cost under $4.' },
    ] }} />);
    const cells = firstRowCells();
    expect(cells[0]).toContain('Sonnet');
    expect(cells[1]).toContain('Line-item reasoning');
    expect(screen.getByText('Model tier')).toBeInTheDocument();
  });
});

describe('TriggerSetWidget columns', () => {
  it('the source leaves the far-right trail for a column of its own', async () => {
    const { TriggerSetWidget } = await import('../TriggerSetWidget');
    render(<TriggerSetWidget config={{ triggers: [
      { label: 'Nightly reconciliation', source: 'schedule', condition: 'Every day at 02:00' },
    ] }} />);
    const cells = firstRowCells();
    expect(cells[0]).toContain('schedule');
    expect(cells[1]).toContain('Every day at 02:00');
  });
});
