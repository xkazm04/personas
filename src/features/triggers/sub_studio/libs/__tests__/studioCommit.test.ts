/**
 * Pins the Chain Studio commit contract: which draft links are committable,
 * through which path (direct chain-trigger vs configure-&-commit modal), and
 * the exact backend shapes the mapping produces — especially the jsonpath
 * condition (engine/chain.rs names the path field literally "jsonpath").
 */
import { describe, it, expect } from 'vitest';
import {
  commitBlocker, draftLinkToTriggerInput, formConfigToTriggerInput,
  linkCommitsViaForm, FORM_COMMITTABLE_SOURCE_TYPES,
} from '../studioCommit';
import type { DraftLink } from '../studioDraftModel';

const personaLink = (over: Partial<DraftLink> = {}): DraftLink => ({
  id: 'l1',
  source: { kind: 'persona', personaId: 'src-1' },
  targetPersonaId: 'tgt-1',
  condition: null,
  ...over,
});

const triggerLink = (triggerType: string): DraftLink => ({
  id: 'l2',
  source: { kind: 'trigger', triggerType },
  targetPersonaId: 'tgt-1',
  condition: null,
});

describe('commitBlocker', () => {
  it('persona links with simple conditions are committable', () => {
    expect(commitBlocker(personaLink())).toBeNull();
    expect(commitBlocker(personaLink({ condition: 'on_success' }))).toBeNull();
    expect(commitBlocker(personaLink({ condition: 'on_failure' }))).toBeNull();
  });

  it('output_match blocks until both path and expected are filled', () => {
    expect(commitBlocker(personaLink({ condition: 'output_match' }))).toBe('output_match');
    expect(commitBlocker(personaLink({
      condition: 'output_match', outputMatch: { path: '$.a', expected: '' },
    }))).toBe('output_match');
    expect(commitBlocker(personaLink({
      condition: 'output_match', outputMatch: { path: '  ', expected: 'x' },
    }))).toBe('output_match');
    expect(commitBlocker(personaLink({
      condition: 'output_match', outputMatch: { path: '$.result.status', expected: 'approved' },
    }))).toBeNull();
  });

  it('form-committable signal sources are unblocked; others stay blocked', () => {
    for (const type of FORM_COMMITTABLE_SOURCE_TYPES) {
      expect(commitBlocker(triggerLink(type))).toBeNull();
      expect(linkCommitsViaForm(triggerLink(type))).toBe(true);
    }
    // chain-as-source = use a persona source; manual has nothing to configure.
    expect(commitBlocker(triggerLink('chain'))).toBe('signal_source');
    expect(commitBlocker(triggerLink('manual'))).toBe('signal_source');
    expect(linkCommitsViaForm(triggerLink('chain'))).toBe(false);
  });
});

describe('draftLinkToTriggerInput', () => {
  it('maps simple conditions onto the backend ChainCondition', () => {
    const input = draftLinkToTriggerInput(personaLink({ condition: 'on_success' }));
    expect(input).not.toBeNull();
    expect(input?.persona_id).toBe('tgt-1');
    expect(input?.trigger_type).toBe('chain');
    const cfg = JSON.parse(input!.config);
    expect(cfg.source_persona_id).toBe('src-1');
    expect(cfg.condition).toEqual({ type: 'success' });
    expect(cfg.event_type).toBe('chain_triggered');
    expect(cfg.payload_forward).toBe(true);
  });

  it('maps output_match to the jsonpath condition with the literal field names', () => {
    const input = draftLinkToTriggerInput(personaLink({
      condition: 'output_match',
      outputMatch: { path: ' $.result.status ', expected: ' approved ' },
    }));
    const cfg = JSON.parse(input!.config);
    expect(cfg.condition).toEqual({
      type: 'jsonpath',
      jsonpath: '$.result.status', // trimmed; field literally named "jsonpath"
      expected: 'approved',
    });
  });

  it('returns null for incomplete output_match and for signal sources', () => {
    expect(draftLinkToTriggerInput(personaLink({ condition: 'output_match' }))).toBeNull();
    expect(draftLinkToTriggerInput(triggerLink('schedule'))).toBeNull();
  });
});

describe('formConfigToTriggerInput', () => {
  it('creates the source-typed trigger on the TARGET persona', () => {
    const input = formConfigToTriggerInput(triggerLink('schedule'), 'schedule', {
      cron: '0 3 * * 1', timezone: 'Europe/Prague',
    });
    expect(input.persona_id).toBe('tgt-1');
    expect(input.trigger_type).toBe('schedule');
    expect(input.enabled).toBe(true);
    expect(JSON.parse(input.config)).toEqual({ cron: '0 3 * * 1', timezone: 'Europe/Prague' });
  });
});
