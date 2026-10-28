// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CompanionTemplateMatch } from '@/api/companion';
import {
  intentKeywords,
  MAX_KEYWORDS,
  MIN_KEYWORD_LEN,
  STOP_WORDS,
  matchOverlap,
  isStrongMatch,
  strongMatches,
  shouldSurfaceTemplateSuggestion,
} from '../buildTemplateMatchConfidence';

const mk = (over: Partial<CompanionTemplateMatch> = {}): CompanionTemplateMatch => ({
  id: 'r1',
  name: 'Idea Harvester',
  snippet: 'Autonomous harvester that mines product ideas from a Slack backlog and triages them.',
  category: 'productivity',
  connectors: ['slack'],
  ...over,
});

describe('intentKeywords', () => {
  it('lowercases, drops short words + stop words, and dedupes', () => {
    expect(intentKeywords('Harvest the IDEAS and harvest from Slack')).toEqual([
      'harvest',
      'ideas',
      'slack',
    ]);
  });

  it('returns empty for stop-words-only / too-short input', () => {
    expect(intentKeywords('the and to a')).toEqual([]);
  });
});

// The matcher (`extract_keywords` in templates.rs) splits on any non-letter in
// any script and measures bytes. The gate must agree with it, or it judges a
// different keyword set than the one that found the match.
describe('intentKeywords outside ASCII', () => {
  it('keeps accented words whole instead of cutting them into fragments', () => {
    expect(intentKeywords('Přehled úkolů z Gmailu')).toEqual(['přehled', 'úkolů', 'gmailu']);
  });

  it('keeps CJK words, which are three or more UTF-8 bytes each', () => {
    expect(intentKeywords('发送 邮件 摘要')).toEqual(['发送', '邮件', '摘要']);
  });

  it('lets a match the backend found for a Chinese intent through the gate', () => {
    const m = mk({ name: '邮件 摘要', snippet: '每天发送邮件摘要', category: null, connectors: [] });
    expect(isStrongMatch('发送 邮件 摘要', m)).toBe(true);
  });

  it('judges only the first 8 keywords, as the matcher searched only those', () => {
    const intent = 'alpha bravo charlie delta echo foxtrot golf hotel india';
    expect(intentKeywords(intent)).toHaveLength(8);
    expect(intentKeywords(intent)).not.toContain('india');
  });
});

describe('keyword rules agree with templates.rs', () => {
  const rs = readFileSync(
    resolve(__dirname, '../../../../../../src-tauri/src/commands/companion/templates.rs'),
    'utf8',
  ).replace(/\/\/.*$/gm, '');

  it('has the same STOP_WORDS, MIN_KEYWORD_LEN and cap', () => {
    const list = /const STOP_WORDS: &\[&str\] = &\[([\s\S]*?)\];/.exec(rs)?.[1] ?? '';
    const words = Array.from(list.matchAll(/"([^"]+)"/g), (m) => m[1]);
    expect(words.length).toBeGreaterThan(0);
    expect(new Set(words)).toEqual(STOP_WORDS);
    expect(Number(/const MIN_KEYWORD_LEN: usize = (\d+);/.exec(rs)?.[1])).toBe(MIN_KEYWORD_LEN);
    const body = /fn extract_keywords[\s\S]*?\n\}/.exec(rs)?.[0] ?? '';
    expect(Number(/\.take\((\d+)\)/.exec(body)?.[1])).toBe(MAX_KEYWORDS);
    expect(body).toMatch(/!c\.is_alphanumeric\(\)/);
    expect(body).toMatch(/w\.len\(\) >= MIN_KEYWORD_LEN/);
  });
});

describe('matchOverlap', () => {
  it('counts distinct keywords by substring (stems/plurals count)', () => {
    // "idea" ⊂ "ideas", "harvest" ⊂ "harvester", "triage" ⊂ "triages"-style
    const n = matchOverlap('harvest idea triage slack', mk());
    expect(n).toBe(4);
  });

  it('is zero when nothing overlaps', () => {
    expect(matchOverlap('forecast weather rainfall', mk())).toBe(0);
  });
});

describe('isStrongMatch', () => {
  it('passes when overlap meets the threshold', () => {
    expect(isStrongMatch('harvest product ideas from slack', mk())).toBe(true);
  });

  it('suppresses a single-keyword coincidence', () => {
    // Only "slack" overlaps → 1 < MIN_OVERLAP(2) → weak.
    expect(isStrongMatch('post a slack standup reminder daily', mk())).toBe(false);
  });

  it('allows a 1-keyword intent to pass on its single keyword', () => {
    expect(isStrongMatch('harvester', mk())).toBe(true);
  });
});

describe('strongMatches', () => {
  it('keeps order and filters out weak rows', () => {
    const rows = [
      mk({ id: 'strong', name: 'Idea Harvester' }),
      mk({ id: 'weak', name: 'Weather Bot', snippet: 'daily forecast', category: 'utility', connectors: ['openweather'] }),
    ];
    const out = strongMatches('harvest product ideas from slack', rows);
    expect(out.map((m) => m.id)).toEqual(['strong']);
  });
});

describe('shouldSurfaceTemplateSuggestion', () => {
  it('surfaces while questions are pending', () => {
    expect(shouldSurfaceTemplateSuggestion(3, false)).toBe(true);
  });

  it('stays hidden before any question lands', () => {
    expect(shouldSurfaceTemplateSuggestion(0, false)).toBe(false);
  });

  it('stays hidden once dismissed', () => {
    expect(shouldSurfaceTemplateSuggestion(3, true)).toBe(false);
  });
});
