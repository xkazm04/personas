/**
 * The analyze step counted survivors only — `selectedToolIndices.size` and its
 * two siblings — so a workflow node the parser could not map never appeared
 * anywhere, and the importer found the missing Slack step after the persona was
 * built.
 *
 * The cases below are about the ledger's HONESTY, not its arithmetic:
 *  - an unreadable source yields NO ledger, never a zero that reads as
 *    "the file was empty";
 *  - `unrepresented` is floored, because an adapter's fallback triggers
 *    correspond to no node and a negative "dropped" would be invented;
 *  - a user's own untick is reported separately from an unsupported node type,
 *    because they are different losses with different remedies.
 */
import { afterEach, describe, it, expect } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { AgentIR } from '@/lib/types/designTypes';
import { computeImportLedger } from '../importLedger';
import { N8nImportLedger } from '../steps/N8nImportLedger';

/** Six n8n nodes; the parse below recognises four of them. */
const SIX_NODE_WORKFLOW = JSON.stringify({
  name: 'Ticket triage',
  nodes: [
    { name: 'Cron', type: 'n8n-nodes-base.cron' },
    { name: 'Gmail', type: 'n8n-nodes-base.gmail' },
    { name: 'Slack', type: 'n8n-nodes-base.slack' },
    { name: 'Notion', type: 'n8n-nodes-base.notion' },
    { name: 'Weird', type: 'n8n-nodes-base.somethingUnmapped' },
    { name: 'Weirder', type: 'n8n-nodes-base.alsoUnmapped' },
  ],
  connections: {},
});

function ir(tools: string[], triggers: unknown[]): AgentIR {
  return {
    suggested_tools: tools,
    suggested_triggers: triggers,
    suggested_connectors: [],
  } as unknown as AgentIR;
}

afterEach(cleanup);

describe('computeImportLedger', () => {
  it('reconciles the source count against what the parse produced', () => {
    const ledger = computeImportLedger(SIX_NODE_WORKFLOW, ir(['gmail_a', 'slack_b', 'notion_c'], [{}]));
    expect(ledger).not.toBeNull();
    expect(ledger).toMatchObject({
      detected: 6,
      noun: 'node',
      represented: 4,
      unrepresented: 2,
      selected: 4,
      deselected: 0,
    });
  });

  it('counts the user\'s own unticks separately from unsupported nodes', () => {
    const ledger = computeImportLedger(
      SIX_NODE_WORKFLOW,
      ir(['gmail_a', 'slack_b', 'notion_c'], [{}]),
      new Set([0]),           // one of three tools kept
      new Set([0]),           // the trigger kept
    );
    expect(ledger).toMatchObject({ represented: 4, unrepresented: 2, selected: 2, deselected: 2 });
  });

  it('floors the dropped count — a fallback trigger belongs to no node', () => {
    const ledger = computeImportLedger(
      JSON.stringify({ nodes: [{ name: 'Only', type: 'n8n-nodes-base.gmail' }], connections: {} }),
      ir(['gmail_a'], [{}, {}]),
    );
    expect(ledger?.detected).toBe(1);
    expect(ledger?.represented).toBe(3);
    expect(ledger?.unrepresented).toBe(0);
  });

  it('renders nothing rather than a fabricated zero when the source is unreadable', () => {
    expect(computeImportLedger('not json', ir([], []))).toBeNull();
    expect(computeImportLedger('', ir([], []))).toBeNull();
    expect(computeImportLedger('[1,2,3]', ir([], []))).toBeNull();
    expect(computeImportLedger(JSON.stringify({ nothing: true }), ir([], []))).toBeNull();
  });
});

describe('N8nImportLedger', () => {
  // `templates` is a lazily-loaded i18n section, so the first paint renders the
  // rows with empty strings; the numbers are asserted once the bundle lands.
  it('shows detected, kept and dropped for a lossy import', async () => {
    const ledger = computeImportLedger(SIX_NODE_WORKFLOW, ir(['a', 'b', 'c'], [{}]))!;
    render(<N8nImportLedger ledger={ledger} />);

    await waitFor(() =>
      expect(screen.getByTestId('n8n-ledger-detected').textContent).toContain('6 nodes'),
    );
    expect(screen.getByTestId('n8n-ledger-represented').textContent).toContain('4');
    expect(screen.getByTestId('n8n-ledger-unrepresented').textContent).toContain('2');
    expect(screen.queryByTestId('n8n-ledger-clean')).toBeNull();
  });

  it('says so when nothing was lost', () => {
    const ledger = computeImportLedger(
      JSON.stringify({ nodes: [{ name: 'Only', type: 'n8n-nodes-base.gmail' }], connections: {} }),
      ir(['gmail_a'], []),
    )!;
    render(<N8nImportLedger ledger={ledger} />);

    expect(screen.getByTestId('n8n-ledger-clean')).toBeTruthy();
    expect(screen.queryByTestId('n8n-ledger-unrepresented')).toBeNull();
  });
});
