/**
 * Unit tests for the Simple-mode illustration resolver.
 *
 * Covers all four tiers of the cascade + URL shape + empty-persona
 * short-circuit. `useIllustration` is a `useMemo` wrapper over the pure
 * `resolveIllustration`, so exercising the resolver directly is sufficient
 * for behavior coverage; we add one render-hook smoke test for the wrapper.
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
      // '👨‍💻' is 'MAN' + ZWJ + 'LAPTOP'. We expect either a direct EMOJI_MAP
      // hit on the full sequence OR a component hit on '💻', both of which
      // land on 'code'.
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
      // 'inbox' is a tier-2 keyword for email; it precedes 'invoice' in
      // KEYWORD_MAP declaration order, so the mixed description below falls
      // on email even though "invoice" is present. That's correct per the
      // plan's declared ordering.
      const mixed = resolveIllustration(
        persona({
          id: 'x',
          name: 'Receipts Buddy',
          description: 'Watches the inbox for invoice attachments',
          icon: null,
        }),
      );
      expect(mixed.category).toBe('email');

      // Isolate the finance keyword by giving a description that doesn't
      // contain any earlier-category substring (no 'pr', 'inbox', 'chat',
      // 'draft', etc.).
      const isolated = resolveIllustration(
        persona({ id: 'x', name: '', description: 'Tracks the monthly expense budget', icon: null }),
      );
      expect(isolated.category).toBe('finance');
    });

    it('description containing "meeting" resolves to meetings', () => {
      // Use a description that avoids earlier-category substrings so the
      // scan reaches the meetings bucket. Previous fixtures had 'draft'
      // (writing) and 'pr' inside 'processes' (code) which outran meetings.
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
      // We assert the function produces *a* valid category for a diverse set
      // of ids rather than asserting two specific ids differ (that would be
      // an implementation-detail test). Coverage of determinism + validity
      // is enough.
      const results = new Set(
        ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n'].map(
          (id) => resolveIllustration(persona({ id, ...noHints })).category,
        ),
      );
      // With 14 distinct ids across 12 buckets + a simple hash, it is
      // extremely unlikely to land on exactly one bucket. Assert at least 2
      // distinct categories appear.
      expect(results.size).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Empty persona fallback', () => {
    it('fully empty persona resolves to general (not CATEGORIES[0] via hash(0))', () => {
      // Documented choice: persona with no id, name, description, or icon
      // short-circuits to 'general'. Without this, hashId('') === 0 would
      // land on CATEGORIES[0] === 'email' — misleading for a zero-hint
      // persona. This test locks that intent.
      const result = resolveIllustration(
        persona({ id: '', name: '', description: null, icon: null }),
      );
      expect(result.category).toBe('general');
    });

    it('persona with only an id still resolves via hash (not the empty short-circuit)', () => {
      const result = resolveIllustration(
        persona({ id: 'some-id', name: '', description: null, icon: null }),
      );
      // Whatever the hash produces, it must be a valid category and must
      // NOT be 'general' only by accident — just check validity + URL.
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
  // Regression: two-letter keys 'pr' and 'dm' used to substring-match inside
  // unrelated words like 'processes' and 'admin'/'standup', producing bogus
  // category assignments. Phase 15-01 replaced them with full-word variants
  // ('pull request', 'pr review', 'direct message', 'dms', 'dming').
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

describe('design_context enrichment (Phase 16)', () => {
  // Phase 16 Topic A: Tier-2 keyword scan now concatenates
  // persona.design_context's summary + useCases[].name/description into the
  // haystack. Parse failures are swallowed so the resolver never crashes.
  it('parses design_context.useCases to enrich keyword scan', () => {
    // Name + description carry no keyword signal — this test would have hit
    // the hash fallback before Phase 16. With enrichment, the 'report' keyword
    // in the use-case name lands it in 'data' category.
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
    // 'report' is in the 'data' keyword bucket and 'invoice'/'finance' is in
    // 'finance' — but 'finance' declaration order comes BEFORE 'data'.
    // The summary "Money tracker" + use-case "Summarize invoices" contains
    // 'invoice' which hits 'finance' first. Lock the finance resolution.
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
    // Tier-2 from name still works even though context parsing threw.
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

describe('template_category tier-3 (Phase 17)', () => {
  // Phase 17 Topic A: `persona.template_category` is populated by the Rust
  // `infer_template_category` helper during template adoption. The resolver
  // maps its 30+ category vocabulary to the 12 illustration bins via
  // TEMPLATE_CATEGORY_MAP. Unmapped categories fall through to tier-4 hash.

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
      // Name has 'docs' which could trigger tier-2, but 'writing' is expected
      // only if tier-3 fires BEFORE tier-2. Use an id so tier-4 isn't empty.
      // NOTE: tier-3 runs AFTER tier-2 in the cascade — so if name contains a
      // tier-2 keyword, tier-2 wins. Use a name with no tier-2 hits.
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
        name: 'Zzzz', // no tier-2 hit
        description: 'qqqqq', // no tier-2 hit
        icon: null,
        template_category: 'brand-new-category-not-in-map',
      }),
    );
    // The unmapped category should NOT throw, and should return a valid
    // category from CATEGORIES via the hash tier.
    expect(CATEGORIES).toContain(r.category as IllustrationCategory);
    expect(r.url).toMatch(URL_RE);
  });

  it('tier-3 fires BEFORE tier-4 hash when category maps', () => {
    // Pick two personas with the same id (→ same tier-4 hash bucket) but
    // one with template_category='finance' — they should diverge because
    // tier-3 short-circuits before tier-4 for the mapped persona.
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
    // Not guaranteed to differ from hashOnly.category, but if they coincide
    // it must be because hash(id)%12 also lands on 'finance'; the tier-3
    // path is still correct. What we lock here is that tier-3 returns
    // 'finance' regardless of the hash-tier outcome.
    expect(tier3.category).toBe('finance');
    // Sanity: hashOnly is still a valid category.
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
