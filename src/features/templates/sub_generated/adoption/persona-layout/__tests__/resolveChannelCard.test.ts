import { describe, it, expect } from 'vitest';
import en from '@/i18n/locales/en.json';
import cs from '@/i18n/locales/cs.json';
import type { Translations } from '@/i18n/generated/types';
import type { ChannelSpecV2 } from '@/lib/bindings/ChannelSpecV2';
import { resolveChannelCard } from '../adoptionDimHelpers';

// Czech over English, as the runtime proxy merges a locale section.
const tCs = { ...en, templates: { ...en.templates, adoption: { ...en.templates.adoption, ...cs.templates.adoption } } } as unknown as Translations;

const ch = (type: string) => ({ type }) as unknown as ChannelSpecV2;

describe('resolveChannelCard labels', () => {
  it('words the built-in channels through the catalog', () => {
    expect(resolveChannelCard(ch('built-in'), tCs).label).toBe(cs.templates.adoption.channel_inbox);
    expect(resolveChannelCard(ch('titlebar'), tCs).label).toBe(cs.templates.adoption.channel_title_bar);
    expect(resolveChannelCard(ch('email'), tCs).label).toBe(cs.templates.adoption.channel_email);
    expect(cs.templates.adoption.channel_inbox).not.toBe('Inbox');
  });
});
