/**
 * The Cockpit's lists are `UnifiedTable`s — the app's ONE table (home-3, batch UT).
 *
 * Owner, 2026-10-03: *"Remove column 'detail' from the table, reuse components to render table we
 * should share across the app (`EventLogList.tsx`)"*, and, asked which table system wins,
 * **"UnifiedTable everywhere, retire kit Rows columns."** These tests pin what that ruling means
 * on this surface: every list is the shared table, every column carries a head that NAMES what it
 * holds (never the generic "Detail" the owner removed by name), a row is one line high, no day
 * grouping is drawn, and a row's meaning rides on the table's left accent with its label still
 * spoken.
 *
 * `.row-hover-lift` is `UnifiedTable`'s own row class; the table exposes no per-row test hook, so
 * it is the stable address for "one row of that table".
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

/** The rows of the one table inside a widget. */
function rowsOf(testId: string): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(`[data-testid="${testId}"] .row-hover-lift`));
}

/** The cells of one row, in the table's column order. */
function cellsOf(row: HTMLElement): string[] {
  return Array.from(row.children).map((c) => c.textContent ?? '');
}

/** The column heads the table drew, in order. */
function headsOf(testId: string): string[] {
  const table = document.querySelector(`[data-testid="${testId}"]`)!;
  const header = table.querySelector('.grid.border-b')!;
  return Array.from(header.children).map((c) => (c.textContent ?? '').trim());
}

const ISSUES = [
  { id: 'i1', title: 'Sentry token expires in 2 days', sublabel: 'Rotate before Thursday', severity: 'warn' },
  { id: 'i2', title: 'Invoice Reconciler failed', sublabel: 'Budget cap reached', severity: 'bad' },
];

describe('IssueListWidget', () => {
  it('names the reason column "Why" — never the generic "Detail" head the owner removed', () => {
    render(<IssueListWidget title="Needs attention" config={{ items: ISSUES }} />);
    const heads = headsOf('cockpit-issue-list-table');
    expect(heads).toEqual(['Issue', 'Why']);
    expect(heads).not.toContain('Detail');
  });

  it('spreads the sublabel into its own column instead of stacking it under the title', () => {
    render(<IssueListWidget title="Needs attention" config={{ items: ISSUES }} />);
    const rows = rowsOf('cockpit-issue-list-table');
    expect(rows).toHaveLength(2);
    // The severity is drawn on the row's left accent, and still spoken in the name cell.
    expect(cellsOf(rows[0]!)).toEqual(['Needs a look: Sentry token expires in 2 days', 'Rotate before Thursday']);
    expect(rows[0]!.className).toContain('border-l-status-warning/70');
  });

  it('declares no second column when no item carries a sublabel', () => {
    render(<IssueListWidget title="Needs attention" config={{ items: [{ id: 'a', title: 'Bare' }] }} />);
    expect(headsOf('cockpit-issue-list-table')).toEqual(['Issue']);
  });

  it('puts the worst severity on the TILE rail rather than repeating it in text', () => {
    render(<IssueListWidget title="Needs attention" config={{ items: ISSUES }} />);
    const mark = document.querySelector('.k-dtile > .k-mark')!;
    expect(mark.className).toContain('t-error');
  });
});

describe('TimelineWidget', () => {
  it('reads as what / what it says / when, on one row height and with no day group header', () => {
    render(
      <TimelineWidget config={{ events: [
        { label: 'Run stopped', detail: 'Budget cap reached', timestamp: '2026-09-22T02:07:00Z', intent: 'bad' },
      ] }} />,
    );
    expect(headsOf('cockpit-timeline-table')).toEqual(['Event', 'Description', 'When']);
    const rows = rowsOf('cockpit-timeline-table');
    expect(cellsOf(rows[0]!)[1]).toBe('Budget cap reached');
    // No `groupBy`: the day rides in the time column, not in a sticky bucket header.
    expect(document.querySelector('[data-group-header]')).toBeNull();
    expect(cellsOf(rows[0]!)[2]).toMatch(/\d{2}:\d{2}/);
  });
});

function cred(i: number, ok: boolean | null, message: string | null = null): CredentialMetadata {
  return {
    id: `c-${i}`, name: `Service ${i}`, service_type: 'svc', serviceType: 'svc', metadata: null,
    healthcheck_last_success: ok, healthcheck_last_message: message,
  } as unknown as CredentialMetadata;
}

describe('ConnectedServicesWidget', () => {
  beforeEach(() => {
    useAgentStore.setState({ personas: [], fetchPersonas: vi.fn().mockResolvedValue(undefined) } as never);
  });

  it('the probe message is the status cell on a failing row, the health word on a healthy one', () => {
    useVaultStore.setState({
      credentials: [cred(1, false, 'Token expired'), cred(2, true)],
      fetchCredentials: vi.fn().mockResolvedValue(undefined),
    } as never);
    render(<ConnectedServicesWidget config={{}} />);
    const rows = rowsOf('cockpit-connected-services-table');
    expect(cellsOf(rows[0]!)[1]).toContain('Token expired');
    expect(cellsOf(rows[1]!)[1]).not.toContain('Token expired');
    expect(rows[0]!.className).toContain('border-l-status-error/70');
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

describe('PersonaOverviewWidget', () => {
  it('the roster is who / how / how healthy / how trusted - and carries no description column', () => {
    useAgentStore.setState({
      personas: [
        persona({ id: 'hero', name: 'Incident Commander' }),
        persona({ id: 'p2', name: 'Inbox Triage', description: 'Sorts the morning inbox' }),
      ],
      fetchPersonas: vi.fn().mockResolvedValue(undefined),
    } as never);
    render(<PersonaOverviewWidget title="Your fleet" config={{ hero: 'hero' }} />);
    // The description WAS the "Detail" column the owner removed by name, and on the 5-span roster
    // it truncated the row's one emphasis - the persona's name - to make room for itself.
    expect(headsOf('cockpit-persona-overview-table')).toEqual(['Persona', 'Model', 'Status', 'Trust']);
    const cells = cellsOf(rowsOf('cockpit-persona-overview-table')[0]!);
    expect(cells).toHaveLength(4);
    expect(cells[0]).toContain('Inbox Triage');
    expect(cells[0]).not.toContain('Sorts the morning inbox');
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

describe('DecisionLogWidget', () => {
  it('the topic, the choice and the rationale are three named columns, not one run-on name', async () => {
    const { DecisionLogWidget } = await import('../DecisionLogWidget');
    render(<DecisionLogWidget config={{ decisions: [
      { label: 'Model tier', choice: 'Sonnet', rationale: 'Line-item reasoning at a nightly cost under $4.' },
    ] }} />);
    expect(headsOf('companion-decision-log-table')).toEqual(['Decision', 'Choice', 'Why', 'When']);
    const cells = cellsOf(rowsOf('companion-decision-log-table')[0]!);
    expect(cells[0]).toContain('Model tier');
    expect(cells[1]).toContain('Sonnet');
    expect(cells[2]).toContain('Line-item reasoning');
  });
});

describe('TriggerSetWidget', () => {
  it('the source and the condition are named columns, never a "Detail" one', async () => {
    const { TriggerSetWidget } = await import('../TriggerSetWidget');
    render(<TriggerSetWidget config={{ triggers: [
      { label: 'Nightly reconciliation', source: 'schedule', condition: 'Every day at 02:00' },
    ] }} />);
    const heads = headsOf('companion-trigger-set-table');
    expect(heads).toEqual(['Trigger', 'Source', 'Fires when']);
    expect(heads).not.toContain('Detail');
    const cells = cellsOf(rowsOf('companion-trigger-set-table')[0]!);
    expect(cells[1]).toContain('schedule');
    expect(cells[2]).toContain('Every day at 02:00');
  });
});
