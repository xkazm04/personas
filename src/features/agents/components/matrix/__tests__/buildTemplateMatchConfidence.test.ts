import { describe, expect, it } from 'vitest';
import type { CompanionTemplateMatch } from '@/api/companion';
import {
  intentKeywords,
  matchOverlap,
  isStrongMatch,
  strongMatches,
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
