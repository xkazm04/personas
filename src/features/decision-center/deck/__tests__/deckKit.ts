/** Shared fakes for the deck's part tests: a controller and a verb set with every verb a spy. */
import { vi } from 'vitest';
import type { TriageReasonPrompt } from '@/features/agents/quick-answer/triage/triageTypes';
import { modalTypeOf, type DecisionItem } from '../../model/decisionModel';
import type { DeckActions } from '../useDeckActions';
import type { DeckController } from '../useDeck';

export function fakeDeck(item: DecisionItem, over: { armed?: 'accept' | 'reject' | null; prompt?: TriageReasonPrompt | null } = {}): DeckController {
  return {
    queue: [item],
    index: 0,
    item,
    motion: { dir: 1, leave: 'walk' },
    stamp: null,
    armed: over.armed ?? null,
    prompt: over.prompt ?? null,
    setArmed: vi.fn(),
    setPrompt: vi.fn(),
    walk: vi.fn(),
    decide: vi.fn(),
    reject: vi.fn(),
  };
}

export function fakeActions(item: DecisionItem, offset = 0): DeckActions {
  return {
    type: modalTypeOf(item.kind),
    readOnly: false,
    offset,
    accept: vi.fn(),
    defaultAccept: vi.fn(),
    reject: vi.fn(),
    confirm: vi.fn(() => false),
    skip: vi.fn(),
    done: vi.fn(),
    branch: vi.fn(() => true),
    reply: vi.fn(),
    submitReason: vi.fn(),
    openLink: vi.fn(),
  };
}
