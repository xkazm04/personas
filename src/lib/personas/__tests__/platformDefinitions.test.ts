import { describe, it, expect } from 'vitest';
import {
  MAKE_DEFINITION,
  N8N_DEFINITION,
  ZAPIER_DEFINITION,
  GITHUB_ACTIONS_DEFINITION,
  resolveService,
  classifyNodeRole,
  extractProtocolsFromNodes,
} from '../platformDefinitions';

describe('resolveService — specificity over declaration order', () => {
  it('prefers google-sheets over the generic google mapping declared before it', () => {
    // MAKE_DEFINITION declares `google` first; without specificity ordering
    // every google-sheets / google-drive module collapsed onto `google`.
    expect(resolveService(MAKE_DEFINITION, 'google-sheets:addRow')).toBe('google-sheets');
    expect(resolveService(MAKE_DEFINITION, 'google-drive:watchFiles')).toBe('google-drive');
    expect(resolveService(MAKE_DEFINITION, 'google-contacts:list')).toBe('google');
  });

  it('falls back to the normalized identifier when no mapping applies', () => {
    expect(resolveService(MAKE_DEFINITION, 'acme-widgets:doThing')).toBe('acme-widgets');
    expect(resolveService(MAKE_DEFINITION, undefined)).toBe('unknown');
  });

  it('resolves Zapier app slugs to their canonical service', () => {
    expect(resolveService(ZAPIER_DEFINITION, 'google-sheets')).toBe('google-sheets');
    expect(resolveService(ZAPIER_DEFINITION, 'google-mail')).toBe('gmail');
    expect(resolveService(ZAPIER_DEFINITION, undefined)).toBe('unknown');
  });

  it('strips the n8n namespace and the Trigger suffix', () => {
    expect(resolveService(N8N_DEFINITION, 'n8n-nodes-base.gmailTrigger')).toBe('gmail');
    expect(resolveService(N8N_DEFINITION, 'n8n-nodes-base.googleSheets')).toBe('google-sheets');
    expect(resolveService(N8N_DEFINITION, 'n8n-nodes-base.acmeWidget')).toBe('acmewidget');
  });
});

// The GitHub Actions adapter kept a private action -> service map walked with
// `includes()`, so an org-level pattern could match the MIDDLE of an unrelated
// repository name and hand the whole IR the wrong identity string. Routed
// through the one entry point, its patterns are anchored to the start of
// `owner/repo` instead.
describe('resolveService — GitHub Actions', () => {
  it('maps the well-known actions to their service', () => {
    expect(resolveService(GITHUB_ACTIONS_DEFINITION, 'actions/checkout@v4')).toBe('git');
    expect(resolveService(GITHUB_ACTIONS_DEFINITION, 'aws-actions/configure-aws-credentials@v4')).toBe('aws');
    expect(resolveService(GITHUB_ACTIONS_DEFINITION, 'azure/login@v2')).toBe('azure');
  });

  it('does not claim a third-party repo that merely contains an org pattern', () => {
    expect(resolveService(GITHUB_ACTIONS_DEFINITION, 'someorg/my-aws-actions-helper@v1'))
      .toBe('my-aws-actions-helper');
    expect(resolveService(GITHUB_ACTIONS_DEFINITION, 'someorg/azure-tools@v1')).toBe('azure-tools');
  });

  it('falls back to the repository name, then to a generic action', () => {
    expect(resolveService(GITHUB_ACTIONS_DEFINITION, 'acme/deploy-tool@v3')).toBe('deploy-tool');
    expect(resolveService(GITHUB_ACTIONS_DEFINITION, 'docker://alpine')).toBe('action');
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
