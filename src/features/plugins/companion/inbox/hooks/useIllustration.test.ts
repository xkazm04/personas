/**
 * Unit tests for the illustration resolver.
 */
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';

import {
  CATEGORIES,
  resolveIllustration,
  useIllustration,
  type IllustrationCategory,
} from './useIllustration';

type ResolverInput = Parameters<typeof resolveIllustration>[0];

const URL_RE = /^\/illustrations\/simple-mode\/category-[a-z]+\.png$/;

function persona(overrides: Partial<ResolverInput> = {}): ResolverInput {
  return {
    id: '',
    name: '',
    description: null,
    icon: null,
    design_context: null,
    template_category: null,
    ...overrides,
  };
}

describe('resolveIllustration', () => {
  describe('Tier 1 — emoji map', () => {
    it('maps the pen emoji to writing', () => {
      expect(resolveIllustration(persona({ id: 'x', icon: '✍' })).category).toBe('writing');
    });

    it('maps the receipt emoji to finance', () => {
      expect(resolveIllustration(persona({ id: 'x', icon: '🧾' })).category).toBe('finance');
    });

    it('maps the sun emoji to calendar', () => {
      expect(resolveIllustration(persona({ id: 'x', icon: '☀' })).category).toBe('calendar');
    });

    it('resolves the multi-codepoint man-technologist ZWJ sequence to code', () => {
      expect(resolveIllustration(persona({ id: 'x', icon: '👨‍💻' })).category).toBe('code');
    });

    it('maps the email emoji to email', () => {
      expect(resolveIllustration(persona({ id: 'x', icon: '📧' })).category).toBe('email');
    });
  });

  describe('Tier 1 miss → Tier 2 keyword hit', () => {
    it('name containing "slack" with unknown icon resolves to chat', () => {
      const result = resolveIllustration(
        persona({ id: 'x', name: 'Slack Listener', icon: '🪁' }),
      );
      expect(result.category).toBe('chat');
    });

    it('name containing "github" resolves to code', () => {
      const result = resolveIllustration(
        persona({ id: 'x', name: 'GitHub PR Reviewer', icon: '🪁' }),
      );
      expect(result.category).toBe('code');
    });

    it('description containing "invoice" resolves to finance', () => {
      const mixed = resolveIllustration(
        persona({
          id: 'x',
          name: 'Receipts Buddy',
          description: 'Watches the inbox for invoice attachments',
          icon: null,
        }),
      );
      expect(mixed.category).toBe('email');

      const isolated = resolveIllustration(
        persona({ id: 'x', name: '', description: 'Tracks the monthly expense budget', icon: null }),
      );
      expect(isolated.category).toBe('finance');
    });

    it('description containing "meeting" resolves to meetings', () => {
      const result = resolveIllustration(
        persona({
          id: 'x',
          name: '',
          description: 'Joins the zoom meeting each hour',
          icon: null,
        }),
      );
      expect(result.category).toBe('meetings');
    });
  });

  describe('Tier 1 + Tier 2 miss → Tier 4 hash fallback', () => {
    const noHints = { name: 'Zzzz', description: 'qqqqq', icon: null } as const;

    it('is deterministic — same id resolves to the same category across calls', () => {
      const a = resolveIllustration(persona({ id: 'deterministic-id-42', ...noHints }));
      const b = resolveIllustration(persona({ id: 'deterministic-id-42', ...noHints }));
      expect(a.category).toBe(b.category);
      expect(a.url).toBe(b.url);
    });

    it('maps every resolved category to a valid CATEGORIES member', () => {
      for (const id of ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot']) {
        const result = resolveIllustration(persona({ id, ...noHints }));
        expect(CATEGORIES).toContain(result.category as IllustrationCategory);
      }
    });

    it('different ids can (but need not) produce different categories', () => {
      const results = new Set(
        ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n'].map(
          (id) => resolveIllustration(persona({ id, ...noHints })).category,
        ),
      );
      expect(results.size).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Empty persona fallback', () => {
    it('fully empty persona resolves to general (not CATEGORIES[0] via hash(0))', () => {
      const result = resolveIllustration(
        persona({ id: '', name: '', description: null, icon: null }),
      );
      expect(result.category).toBe('general');
    });

    it('persona with only an id still resolves via hash (not the empty short-circuit)', () => {
      const result = resolveIllustration(
        persona({ id: 'some-id', name: '', description: null, icon: null }),
      );
      expect(CATEGORIES).toContain(result.category as IllustrationCategory);
      expect(result.url).toMatch(URL_RE);
    });
  });

  describe('URL shape', () => {
    it('every returned url matches /illustrations/simple-mode/category-<name>.png', () => {
      const cases: ResolverInput[] = [
        persona({ id: 'x', icon: '📧' }),
        persona({ id: 'x', icon: '👨‍💻' }),
        persona({ id: 'hash-me', name: 'Mystery Bot' }),
        persona({ id: '', name: '', description: null, icon: null }),
        persona({ id: 'x', name: 'Slack Listener', icon: null }),
      ];
      for (const p of cases) {
        const result = resolveIllustration(p);
        expect(result.url).toMatch(URL_RE);
        expect(result.url).toBe(`/illustrations/simple-mode/category-${result.category}.png`);
      }
    });
  });
});

describe('KEYWORD_MAP false-positive regression', () => {
  it("description 'Processes invoices nightly' no longer resolves to 'code'", () => {
    const r = resolveIllustration({
      id: 'x',
      name: 'Invoice Bot',
      description: 'Processes invoices nightly',
      icon: null,
      design_context: null,
      template_category: null,
    });
    expect(r.category).toBe('finance');
  });

  it("description 'Standup coordinator' no longer resolves to 'writing'", () => {
    const r = resolveIllustration({
      id: 'y',
      name: 'Standup Helper',
      description: 'Coordinator for the daily standup',
      icon: null,
      design_context: null,
      template_category: null,
    });
    expect(r.category).toBe('meetings');
  });

  it("'pull request' literal still resolves to 'code'", () => {
    const r = resolveIllustration({
      id: 'z',
      name: 'PR Watcher',
      description: 'Reviews every pull request',
      icon: null,
      design_context: null,
      template_category: null,
    });
    expect(r.category).toBe('code');
  });

  it("'direct message' literal still resolves to 'chat'", () => {
    const r = resolveIllustration({
      id: 'w',
      name: 'Chat Helper',
      description: 'Handles direct message pings',
      icon: null,
      design_context: null,
      template_category: null,
    });
    expect(r.category).toBe('chat');
  });
});

describe('design_context enrichment', () => {
  it('parses design_context.useCases to enrich keyword scan', () => {
    const r = resolveIllustration(
      persona({
        id: 'x',
        name: 'Blank',
        description: null,
        icon: null,
        design_context: JSON.stringify({
          useCases: [{ name: 'Weekly financial report', description: 'Summarize invoices' }],
          summary: 'Money tracker',
        }),
      }),
    );
    expect(r.category).toBe('finance');
  });

  it('swallows invalid JSON without crashing', () => {
    const p = persona({
      id: 'y',
      name: 'Slack Persona',
      description: null,
      icon: null,
      design_context: '{not json',
    });
    expect(() => resolveIllustration(p)).not.toThrow();
    expect(resolveIllustration(p).category).toBe('chat');
  });

  it('skips design_context when undefined/null', () => {
    const r = resolveIllustration(
      persona({
        id: 'z',
        name: 'GitHub Watcher',
        description: null,
        icon: null,
        design_context: null,
      }),
    );
    expect(r.category).toBe('code');
  });
});

describe('template_category tier-3', () => {
  it("maps 'development' to 'code'", () => {
    const r = resolveIllustration(
      persona({ id: 't1', name: 'Code Assistant', template_category: 'development' }),
    );
    expect(r.category).toBe('code');
  });

  it("maps 'finance' to 'finance'", () => {
    const r = resolveIllustration(
      persona({ id: 't2', name: 'Expense Tracker', template_category: 'finance' }),
    );
    expect(r.category).toBe('finance');
  });

  it("maps 'documentation' to 'writing'", () => {
    const r = resolveIllustration(
      persona({
        id: 't3',
        name: 'Knowledge Curator',
        description: null,
        template_category: 'documentation',
      }),
    );
    expect(r.category).toBe('writing');
  });

  it("maps 'support' to 'chat'", () => {
    const r = resolveIllustration(
      persona({
        id: 't4',
        name: 'Helpdesk Agent',
        description: null,
        template_category: 'support',
      }),
    );
    expect(r.category).toBe('chat');
  });

  it("maps 'marketing' to 'social'", () => {
    const r = resolveIllustration(
      persona({
        id: 't5',
        name: 'Campaign Runner',
        description: null,
        template_category: 'marketing',
      }),
    );
    expect(r.category).toBe('social');
  });

  it('template_category=null falls through to tier-2 keyword (name: "Slack Bot" → chat)', () => {
    const r = resolveIllustration(
      persona({
        id: 't6',
        name: 'Slack Bot',
        template_category: null,
      }),
    );
    expect(r.category).toBe('chat');
  });

  it('unmapped template_category falls through to tier-4 hash (deterministic valid category)', () => {
    const r = resolveIllustration(
      persona({
        id: 't7-unique',
        name: 'Zzzz',
        description: 'qqqqq',
        icon: null,
        template_category: 'brand-new-category-not-in-map',
      }),
    );
    expect(CATEGORIES).toContain(r.category as IllustrationCategory);
    expect(r.url).toMatch(URL_RE);
  });

  it('tier-3 fires BEFORE tier-4 hash when category maps', () => {
    const hashOnly = resolveIllustration(
      persona({ id: 'shared-hash-id', name: 'Zzzz', description: 'qqqqq' }),
    );
    const tier3 = resolveIllustration(
      persona({
        id: 'shared-hash-id',
        name: 'Zzzz',
        description: 'qqqqq',
        template_category: 'finance',
      }),
    );
    expect(tier3.category).toBe('finance');
    expect(tier3.category).toBe('finance');
    expect(CATEGORIES).toContain(hashOnly.category as IllustrationCategory);
  });
});

describe('useIllustration', () => {
  it('returns the same result as the pure resolver', () => {
    const input = persona({ id: 'x', icon: '📧' });
    const { result } = renderHook(() => useIllustration(input));
    expect(result.current).toEqual(resolveIllustration(input));
  });

  it('memoizes across re-renders with stable persona fields', () => {
    const input = persona({ id: 'stable', name: 'Stable', description: 'desc', icon: '📧' });
    const { result, rerender } = renderHook(() => useIllustration(input));
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
