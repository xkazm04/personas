import { describe, it, expect } from 'vitest';
import { mergeTemplateOverlay, isOverlayFilename } from '../templateOverlays';

describe('isOverlayFilename', () => {
  it('matches every supported language suffix', () => {
    const langs = ['ar', 'bn', 'cs', 'de', 'es', 'fr', 'hi', 'id', 'ja', 'ko', 'ru', 'vi', 'zh'];
    for (const l of langs) {
      expect(isOverlayFilename(`autonomous-issue-resolver.${l}.json`)).toBe(true);
    }
  });

  it('does not match canonical filenames', () => {
    expect(isOverlayFilename('autonomous-issue-resolver.json')).toBe(false);
    expect(isOverlayFilename('email-morning-digest.json')).toBe(false);
  });

  it('does not match unrelated two-letter segments', () => {
    // "vs" is not in the language list.
    expect(isOverlayFilename('compare.vs.json')).toBe(false);
  });
});

describe('mergeTemplateOverlay — primitives + objects', () => {
  it('returns canonical when overlay is not a plain object', () => {
    const canon = { id: 't', name: 'Canon' };
    expect(mergeTemplateOverlay(canon, null)).toEqual(canon);
    expect(mergeTemplateOverlay(canon, 'string')).toEqual(canon);
    expect(mergeTemplateOverlay(canon, [])).toEqual(canon);
  });

  it('overlay primitives replace canonical', () => {
    const canon = { id: 't', name: 'Canon', description: 'English' };
    const overlay = { name: 'Kanon' };
    expect(mergeTemplateOverlay(canon, overlay)).toEqual({
      id: 't',
      name: 'Kanon',
      description: 'English',
    });
  });

  it('preserves canonical fields overlay does not mention', () => {
    const canon = {
      id: 't',
      icon: 'Wrench',
      color: '#EA580C',
      schema_version: 3,
    };
    expect(mergeTemplateOverlay(canon, { name: 'X' })).toEqual({
      ...canon,
      name: 'X',
    });
  });

  it('recursively merges nested objects', () => {
    const canon = {
      payload: {
        persona: {
          identity: { role: 'Canon role', description: 'Canon desc' },
          voice: { style: 'Canon style' },
        },
      },
    };
    const overlay = {
      payload: {
        persona: {
          identity: { role: 'Překlad' },
        },
      },
    };
    expect(mergeTemplateOverlay(canon, overlay)).toEqual({
      payload: {
        persona: {
          identity: { role: 'Překlad', description: 'Canon desc' },
          voice: { style: 'Canon style' },
        },
      },
    });
  });
});

describe('mergeTemplateOverlay — arrays', () => {
  it('string arrays are replaced wholesale by overlay', () => {
    const canon = {
      principles: ['Respect time', 'Learn from every fix'],
    };
    const overlay = {
      principles: ['Respektuj čas', 'Uč se z každé opravy'],
    };
    expect(mergeTemplateOverlay(canon, overlay)).toEqual({
      principles: ['Respektuj čas', 'Uč se z každé opravy'],
    });
  });

  it('object arrays match by id and merge per item', () => {
    const canon = {
      use_cases: [
        { id: 'uc_a', title: 'Triage', enabled_by_default: true, cron: '*/15 * * * *' },
        { id: 'uc_b', title: 'Digest', enabled_by_default: true, cron: '0 9 * * *' },
      ],
    };
    const overlay = {
      use_cases: [
        { id: 'uc_b', title: 'Přehled' },
        { id: 'uc_a', title: 'Třídění' },
      ],
    };
    expect(mergeTemplateOverlay(canon, overlay)).toEqual({
      use_cases: [
        { id: 'uc_a', title: 'Třídění', enabled_by_default: true, cron: '*/15 * * * *' },
        { id: 'uc_b', title: 'Přehled', enabled_by_default: true, cron: '0 9 * * *' },
      ],
    });
  });

  it('object arrays match by name', () => {
    const canon = {
      connectors: [
        { name: 'jira', label: 'Jira', api_base_url: 'https://x.atlassian.net' },
        { name: 'slack', label: 'Slack', api_base_url: 'https://slack.com/api' },
      ],
    };
    const overlay = {
      connectors: [{ name: 'slack', label: 'Slack (CS)' }],
    };
    expect(mergeTemplateOverlay(canon, overlay)).toEqual({
      connectors: [
        { name: 'jira', label: 'Jira', api_base_url: 'https://x.atlassian.net' },
        { name: 'slack', label: 'Slack (CS)', api_base_url: 'https://slack.com/api' },
      ],
    });
  });

  it('object arrays match by event_type', () => {
    const canon = {
      event_subscriptions: [
        { event_type: 'issue.auto_resolved', direction: 'emit', description: 'EN resolved' },
        { event_type: 'issue.escalated', direction: 'emit', description: 'EN escalated' },
      ],
    };
    const overlay = {
      event_subscriptions: [{ event_type: 'issue.escalated', description: 'CS eskalováno' }],
    };
    expect(mergeTemplateOverlay(canon, overlay)).toEqual({
      event_subscriptions: [
        { event_type: 'issue.auto_resolved', direction: 'emit', description: 'EN resolved' },
        { event_type: 'issue.escalated', direction: 'emit', description: 'CS eskalováno' },
      ],
    });
  });

  it('object arrays match by key (credential_fields)', () => {
    const canon = {
      credential_fields: [
        { key: 'domain', label: 'Domain', type: 'text' },
        { key: 'api_token', label: 'API Token', type: 'password' },
      ],
    };
    const overlay = {
      credential_fields: [{ key: 'domain', label: 'Doména' }],
    };
    expect(mergeTemplateOverlay(canon, overlay)).toEqual({
      credential_fields: [
        { key: 'domain', label: 'Doména', type: 'text' },
        { key: 'api_token', label: 'API Token', type: 'password' },
      ],
    });
  });

  it('object arrays without a match key merge by index', () => {
    // notification_channels has { type, description } — no id/name/key/event_type.
    const canon = {
      notification_channels: [
        { type: 'slack', description: 'Primary alerts' },
        { type: 'slack', description: 'Escalations' },
      ],
    };
    const overlay = {
      notification_channels: [
        { description: 'Primární výstrahy' },
        { description: 'Eskalace' },
      ],
    };
    expect(mergeTemplateOverlay(canon, overlay)).toEqual({
      notification_channels: [
        { type: 'slack', description: 'Primární výstrahy' },
        { type: 'slack', description: 'Eskalace' },
      ],
    });
  });

  it('overlay items referencing unknown ids are silently skipped', () => {
    const canon = {
      use_cases: [{ id: 'uc_a', title: 'A' }],
    };
    const overlay = {
      use_cases: [
        { id: 'uc_unknown', title: 'Should not appear' },
        { id: 'uc_a', title: 'Á' },
      ],
    };
    expect(mergeTemplateOverlay(canon, overlay)).toEqual({
      use_cases: [{ id: 'uc_a', title: 'Á' }],
    });
  });
});

describe('mergeTemplateOverlay — template-specific invariants', () => {
  it('preserves {{param.X}} tokens verbatim', () => {
    const canon = {
      use_cases: [
        {
          id: 'uc_a',
          sample_input: { max_items: '{{param.aq_max}}', cron_hour: 9 },
        },
      ],
    };
    const overlay = {
      use_cases: [{ id: 'uc_a', title: 'Přehled' }],
    };
    const result = mergeTemplateOverlay(canon, overlay) as typeof canon & {
      use_cases: Array<{ title?: string; sample_input?: Record<string, unknown> }>;
    };
    expect(result.use_cases[0].sample_input).toEqual({
      max_items: '{{param.aq_max}}',
      cron_hour: 9,
    });
  });

  it('preserves structural fields (id, cron, maps_to) when overlay omits them', () => {
    const canon = {
      id: 'autonomous-issue-resolver',
      schema_version: 3,
      payload: {
        use_cases: [
          {
            id: 'uc_triage',
            suggested_trigger: { trigger_type: 'polling', config: { cron: '*/15 * * * *' } },
          },
        ],
        adoption_questions: [
          {
            id: 'aq_stale_days',
            maps_to: 'use_cases[uc_triage].sample_input.stale_days',
            question: 'EN q',
          },
        ],
      },
    };
    const overlay = {
      id: 'autonomous-issue-resolver',
      payload: {
        use_cases: [{ id: 'uc_triage', title: 'Třídění' }],
        adoption_questions: [{ id: 'aq_stale_days', question: 'CS q' }],
      },
    };
    const result = mergeTemplateOverlay(canon, overlay) as typeof canon;
    expect(result.id).toBe('autonomous-issue-resolver');
    expect(result.schema_version).toBe(3);
    expect(result.payload.use_cases[0].suggested_trigger.config.cron).toBe('*/15 * * * *');
    expect(result.payload.adoption_questions[0].maps_to).toBe(
      'use_cases[uc_triage].sample_input.stale_days',
    );
    expect(result.payload.adoption_questions[0].question).toBe('CS q');
  });

  it('preserves canonical when overlay is empty', () => {
    const canon = { id: 't', name: 'Canon', description: 'Long desc' };
    expect(mergeTemplateOverlay(canon, {})).toEqual(canon);
  });
});
