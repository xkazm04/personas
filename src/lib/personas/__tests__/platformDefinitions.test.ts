import { describe, it, expect } from 'vitest';
import {
  MAKE_DEFINITION,
  N8N_DEFINITION,
  ZAPIER_DEFINITION,
  resolveNodeType,
  resolveServiceByInclusion,
  classifyNodeRole,
  extractProtocolsFromNodes,
} from '../platformDefinitions';

describe('resolveServiceByInclusion — specificity over declaration order', () => {
  it('prefers google-sheets over the generic google mapping declared before it', () => {
    // MAKE_DEFINITION declares `google` first; without specificity ordering
    // every google-sheets / google-drive module collapsed onto `google`.
    expect(resolveServiceByInclusion(MAKE_DEFINITION, 'google-sheets')).toBe('google-sheets');
    expect(resolveServiceByInclusion(MAKE_DEFINITION, 'google-drive')).toBe('google-drive');
    expect(resolveServiceByInclusion(MAKE_DEFINITION, 'google-contacts')).toBe('google');
  });

  it('returns undefined when no mapping applies', () => {
    expect(resolveServiceByInclusion(MAKE_DEFINITION, 'acme-widgets')).toBeUndefined();
  });

  it('resolves Zapier app slugs to their canonical service', () => {
    expect(resolveServiceByInclusion(ZAPIER_DEFINITION, 'google-sheets')).toBe('google-sheets');
    expect(resolveServiceByInclusion(ZAPIER_DEFINITION, 'google-mail')).toBe('gmail');
  });
});

describe('resolveNodeType', () => {
  it('strips the n8n namespace and the Trigger suffix', () => {
    expect(resolveNodeType(N8N_DEFINITION, 'n8n-nodes-base.gmailTrigger')).toBe('gmail');
    expect(resolveNodeType(N8N_DEFINITION, 'n8n-nodes-base.googleSheets')).toBe('google-sheets');
  });

  it('falls back to the cleaned node name for unmapped types', () => {
    expect(resolveNodeType(N8N_DEFINITION, 'n8n-nodes-base.acmeWidget')).toBe('acmewidget');
  });
});

describe('classifyNodeRole', () => {
  it('classifies triggers, llm nodes and plain tools', () => {
    expect(classifyNodeRole(N8N_DEFINITION, 'n8n-nodes-base.scheduleTrigger')).toBe('trigger');
    expect(classifyNodeRole(N8N_DEFINITION, 'n8n-nodes-base.openAi')).toBe('llm');
    expect(classifyNodeRole(N8N_DEFINITION, 'n8n-nodes-base.slack')).toBe('tool');
  });
});

describe('extractProtocolsFromNodes', () => {
  it('deduplicates protocols across matching node types', () => {
    const protocols = extractProtocolsFromNodes(N8N_DEFINITION, [
      'n8n-nodes-base.slack',
      'n8n-nodes-base.telegram',
      'n8n-nodes-base.wait',
    ]);
    expect(protocols.map((p) => p.type).sort()).toEqual(['manual_review', 'user_message']);
  });

  it('returns nothing when no node matches', () => {
    expect(extractProtocolsFromNodes(N8N_DEFINITION, ['n8n-nodes-base.acmeWidget'])).toEqual([]);
  });
});
