import { describe, expect, it } from 'vitest';

import en from '@/i18n/locales/en.json';
import { interpolate, type Translations } from '@/i18n/useTranslation';
import { buildFixture } from '../../fixture/standupFixture';
import { buildView } from '../../model/buildView';
import { standupBrief, standupChatTitle } from '../standupChat';

// en.json is the source the generated `Translations` type is built from; the cast only re-attaches that type.
const t = en as unknown as Translations;
const view = buildView(buildFixture('decide'));

describe('standupBrief (Plan with Athena)', () => {
  const brief = standupBrief(view, t, interpolate);

  it('names the revision, the standup id and the write-back op', () => {
    expect(brief).toContain('revision 2');
    expect(brief).toContain('fixture-decide');
    expect(brief).toContain('standup_decide');
  });

  it('lists open cards before settled ones, each with its item id, and her pick marked', () => {
    const open = brief.indexOf('Open cards');
    const settled = brief.indexOf('Already settled');
    expect(open).toBeGreaterThan(-1);
    expect(settled).toBeGreaterThan(open);
    expect(brief.indexOf('[item i-cc]')).toBeGreaterThan(open);
    expect(brief.indexOf('[item i-cc]')).toBeLessThan(settled);
    expect(brief.indexOf('[item i-pp]')).toBeGreaterThan(settled);
    expect(brief).toContain('(your pick)');
  });

  it('carries what waits on the operator, without an item line for it', () => {
    expect(brief).toContain('Waiting on me');
    expect(brief).not.toContain('[item undefined]');
  });

  it('titles the thread per standup and revision', () => {
    expect(standupChatTitle(view, t, interpolate)).toBe('Standup · rev 2 · decide');
  });
});
