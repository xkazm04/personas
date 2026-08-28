import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * There was no logger, no Sentry breadcrumb and no counter anywhere under
 * `parsers/`, so a vendor changing its export format produced no signal at all
 * — the first one an operator got was a support ticket. These assert the three
 * moments the pipeline knows something an operator wants to know: a detection
 * outcome, a file nothing could parse, and a node type the table has no row for.
 */
const trackInteraction = vi.fn();
vi.mock('@/lib/sentry', () => ({
  trackInteraction: (...args: unknown[]) => trackInteraction(...args),
}));

const { parseWorkflowFile } = await import('../workflowParser');

function labelsFor(action: string): string[] {
  return trackInteraction.mock.calls
    .filter((call) => call[0] === 'workflow_import' && call[1] === action)
    .map((call) => String(call[2]));
}

describe('workflow import telemetry', () => {
  beforeEach(() => {
    trackInteraction.mockClear();
  });

  it('reports a high-confidence detection with its platform and confidence', () => {
    parseWorkflowFile(
      JSON.stringify({
        name: 'Lead intake',
        connections: {},
        nodes: [{ type: 'n8n-nodes-base.slack', name: 'Post', parameters: {} }],
      }),
      'lead.json',
    );
    expect(labelsFor('detected')).toContain('n8n:high');
  });

  // The counter that matters: a rising speculative rate on one platform is a
  // vendor having shipped a new shape, days before anyone files a ticket.
  it('marks a detection that only survived the speculative fallback', () => {
    parseWorkflowFile(
      JSON.stringify({
        name: 'CI',
        jobs: { build: { 'runs-on': 'ubuntu-latest', steps: [{ uses: 'actions/checkout@v4' }] } },
      }),
      'ci.json',
    );
    expect(labelsFor('detected')).toContain('github-actions:medium:speculative');
  });

  it('reports a file no adapter could parse', () => {
    expect(() => parseWorkflowFile(JSON.stringify({ hello: 'world' }), 'nope.json')).toThrow();
    expect(labelsFor('unrecognized')).toContain('json');
    expect(labelsFor('detected')).toHaveLength(0);
  });

  // The ranked backlog for new nodeTypeMap rows, which was recorded nowhere.
  it('reports node types the platform table has no mapping for', () => {
    parseWorkflowFile(
      JSON.stringify({
        name: 'Custom',
        connections: {},
        nodes: [
          { type: 'n8n-nodes-base.acmeWidget', name: 'Widget', parameters: {} },
          { type: 'n8n-nodes-base.slack', name: 'Post', parameters: {} },
        ],
      }),
      'custom.json',
    );
    const unmapped = labelsFor('unmapped_type');
    expect(unmapped).toContain('n8n:n8n-nodes-base.acmeWidget');
    expect(unmapped).not.toContain('n8n:n8n-nodes-base.slack');
  });
});
