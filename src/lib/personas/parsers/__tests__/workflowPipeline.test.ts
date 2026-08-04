import { describe, it, expect } from 'vitest';
import { runExtractionPipeline, type NormalizedNode } from '../workflowPipeline';

function node(partial: Partial<NormalizedNode> & { label: string; service: string }): NormalizedNode {
  return {
    isTrigger: false,
    rawType: partial.service,
    ...partial,
  };
}

describe('runExtractionPipeline — connector ↔ tool/trigger association', () => {
  it('does not let a connector claim another service\'s tools by name prefix', () => {
    const result = runExtractionPipeline({
      platformLabel: 'n8n',
      platformNoun: 'workflow',
      elementNoun: 'nodes',
      workflowName: 'Prefix collision',
      nodes: [
        node({ label: 'Read Inbox', service: 'google' }),
        node({ label: 'Append Row', service: 'google-sheets' }),
      ],
    });

    const google = result.suggested_connectors!.find((c) => c.name === 'google')!;
    const sheets = result.suggested_connectors!.find((c) => c.name === 'google-sheets')!;

    expect(google.related_tools).toEqual(['google_read_inbox']);
    expect(sheets.related_tools).toEqual(['google-sheets_append_row']);
  });

  it('claims triggers by owning service, not by description substring', () => {
    const result = runExtractionPipeline({
      platformLabel: 'n8n',
      platformNoun: 'workflow',
      elementNoun: 'nodes',
      workflowName: 'Substring collision',
      nodes: [
        node({ label: 'On new Gmail', service: 'gmail', isTrigger: true }),
        node({ label: 'Send mail', service: 'mail' }),
      ],
    });

    const gmail = result.suggested_connectors!.find((c) => c.name === 'gmail')!;
    const mail = result.suggested_connectors!.find((c) => c.name === 'mail')!;

    expect(gmail.related_triggers).toEqual([0]);
    // "mail" is a substring of the gmail trigger description but owns no trigger.
    expect(mail.related_triggers).toEqual([]);
  });

  it('leaves synthetic fallback triggers unclaimed by every connector', () => {
    const result = runExtractionPipeline({
      platformLabel: 'Zapier',
      platformNoun: 'Zap',
      elementNoun: 'steps',
      workflowName: 'No trigger',
      nodes: [node({ label: 'Post message', service: 'slack' })],
      fallbackTriggers: [
        { trigger_type: 'manual', config: {}, description: 'Manual trigger (no Zapier trigger detected)' },
      ],
    });

    expect(result.suggested_triggers).toHaveLength(1);
    const slack = result.suggested_connectors!.find((c) => c.name === 'slack')!;
    expect(slack.related_triggers).toEqual([]);
  });

  it('excludes platform-internal services from connectors but keeps their tools out too', () => {
    const result = runExtractionPipeline({
      platformLabel: 'Zapier',
      platformNoun: 'Zap',
      elementNoun: 'steps',
      workflowName: 'Filtered',
      nodes: [
        node({ label: 'Format date', service: 'formatter' }),
        node({ label: 'Post message', service: 'slack' }),
      ],
      excludedServices: ['formatter'],
    });

    expect(result.suggested_connectors!.map((c) => c.name)).toEqual(['slack']);
    // The tool itself is still suggested — only the connector is suppressed.
    expect(result.suggested_tools).toContain('formatter_format_date');
  });
});
