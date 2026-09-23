import { describe, expect, it } from 'vitest';
import { classifyToolUse, extractToolUses, humanizePath, typicalTurnSeconds } from '../studioActivity';
import { deriveDeck } from '../guide/guideModel';
import { isPlaceholderPlan, MOCK_PHASES, type BuildPhase } from '../studioBuildModel';

const P = (id: string, status: string, title = id): BuildPhase => ({ id, title, status, note: null });

describe('studio activity', () => {
  it('reads tool calls out of a whole assistant stream line', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Working on the nav.' },
          { type: 'tool_use', name: 'Write', input: { file_path: 'components/SiteNav.tsx' } },
          { type: 'tool_use', name: 'Bash', input: { command: 'bun x tsc --noEmit' } },
        ],
      },
    });
    const uses = extractToolUses(line);
    expect(uses.map((u) => u.name)).toEqual(['Write', 'Bash']);
    expect(classifyToolUse(uses[0]!)).toMatchObject({ kind: 'build', subject: 'Site nav' });
    expect(classifyToolUse(uses[1]!).kind).toBe('check');
  });

  it('ignores partial deltas and garbage', () => {
    expect(extractToolUses('{"type":"stream_event"}')).toEqual([]);
    expect(extractToolUses('not json')).toEqual([]);
  });

  it('names route files by their folder', () => {
    expect(humanizePath('app/order/page.tsx')).toBe('Order page');
    expect(humanizePath('lib/basket.ts')).toBe('Basket');
  });

  it('classifies the browser connector and research helpers', () => {
    expect(classifyToolUse({ name: 'mcp__playwright__browser_navigate', input: {} }).kind).toBe('browser');
    expect(classifyToolUse({ name: 'Task', input: { description: 'bakery sites' } })).toMatchObject({ kind: 'research', subject: 'bakery sites' });
  });

  it('takes the median of measured turn lengths', () => {
    expect(typicalTurnSeconds([])).toBeNull();
    expect(typicalTurnSeconds([300, 900, 420])).toBe(420);
    expect(typicalTurnSeconds([300, 500])).toBe(400);
  });
});

describe('guide deck', () => {
  const none = new Set<string>();

  it('treats the seeded stand-in plan as no plan and offers to plan it', () => {
    expect(isPlaceholderPlan(MOCK_PHASES)).toBe(true);
    const deck = deriveDeck({ phases: MOCK_PHASES, activity: [], dismissed: none, placeholder: true });
    expect(deck[0]?.kind).toBe('continue');
    expect(deck[0]?.goal).toBeNull();
  });

  it('continues the active goal and asks for a device check after an unseen build', () => {
    const phases = [P('a', 'done'), P('b', 'active', 'Daily menu'), P('c', 'pending')];
    const activity = [{ id: '1', kind: 'build' as const, subject: 'Menu grid', detail: 'Write', ts: 0 }];
    const deck = deriveDeck({ phases, activity, dismissed: none, placeholder: false });
    expect(deck.map((c) => c.kind)).toEqual(['continue', 'refine', 'devices']);
    expect(deck[0]?.goal).toBe('Daily menu');
    expect(deck[2]?.mcp).toEqual(['playwright']);
  });

  it('keeps a declined card hidden until the plan changes', () => {
    const phases = [P('a', 'active', 'Home')];
    const first = deriveDeck({ phases, activity: [], dismissed: none, placeholder: false })[0]!;
    const again = deriveDeck({ phases, activity: [], dismissed: new Set([first.key]), placeholder: false });
    expect(again.some((c) => c.key === first.key)).toBe(false);
    const moved = deriveDeck({ phases: [P('a', 'done', 'Home'), P('b', 'active', 'Menu')], activity: [], dismissed: new Set([first.key]), placeholder: false });
    expect(moved[0]?.goal).toBe('Menu');
  });

  it('offers a polish pass when every goal is done, never more than three cards', () => {
    const phases = [P('a', 'done'), P('b', 'done')];
    const deck = deriveDeck({ phases, activity: [{ id: '1', kind: 'build', subject: null, detail: '', ts: 0 }], dismissed: none, placeholder: false });
    expect(deck[0]?.kind).toBe('polish');
    expect(deck.length).toBeLessThanOrEqual(3);
  });
});
