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

  // The three `$`-anchored rows were dead for as long as they existed: they were
  // fed to a substring matcher that looked for a literal `$`.
  it('honours the trailing-$ anchor so the decision/utility rows can fire', () => {
    expect(classifyNodeRole(N8N_DEFINITION, 'n8n-nodes-base.if')).toBe('decision');
    expect(classifyNodeRole(N8N_DEFINITION, 'n8n-nodes-base.set')).toBe('utility');
    expect(classifyNodeRole(N8N_DEFINITION, 'n8n-nodes-base.code')).toBe('utility');
  });

  // ...and the anchor is what keeps them from being greedy. An unanchored `if`
  // would swallow every node whose name merely contains those two letters.
  it('does not let an anchored pattern match mid-string', () => {
    expect(classifyNodeRole(N8N_DEFINITION, 'n8n-nodes-base.ifElseBranchHelper')).toBe('tool');
    expect(classifyNodeRole(N8N_DEFINITION, 'n8n-nodes-base.codeSandboxDeploy')).toBe('tool');
  });

  // The anchor must not defeat the earlier trigger rows, which are unanchored.
  it('still prefers the earlier trigger classification', () => {
    expect(classifyNodeRole(N8N_DEFINITION, 'n8n-nodes-base.ifTrigger')).toBe('trigger');
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

  // The Rust ProtocolMapRule (src-tauri/core/src/models/platform_definition.rs,
  // built by pm() in src-tauri/engine/src/platform_rules.rs) has no
  // `node_patterns` field, so a definition arriving over IPC carries rules
  // without `nodePatterns`. Reading it directly threw
  // `TypeError: rule.nodePatterns.some is not a function`; it must degrade to
  // "no structural match" and leave the keyword fallback to do its work.
  it('does not throw on a backend-shaped rule that has no nodePatterns', () => {
    const backendShaped = {
      ...N8N_DEFINITION,
      protocolMapRules: [
        {
          platformPattern: 'Slack/Telegram/Email nodes',
          targetProtocol: 'user_message',
          condition: 'notification node present',
        },
      ],
    } as unknown as typeof N8N_DEFINITION;

    expect(() => extractProtocolsFromNodes(backendShaped, ['n8n-nodes-base.slack'])).not.toThrow();
    expect(extractProtocolsFromNodes(backendShaped, ['n8n-nodes-base.slack'])).toEqual([]);
  });

  it('does not throw when protocolMapRules itself is absent', () => {
    const noRules = {
      ...N8N_DEFINITION,
      protocolMapRules: undefined,
    } as unknown as typeof N8N_DEFINITION;
    expect(extractProtocolsFromNodes(noRules, ['n8n-nodes-base.slack'])).toEqual([]);
  });
});
