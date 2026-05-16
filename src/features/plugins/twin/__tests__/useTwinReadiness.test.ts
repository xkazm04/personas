import { describe, it, expect } from 'vitest';
import { deriveReadiness } from '../useTwinReadiness';
import type { TwinProfile } from '@/lib/bindings/TwinProfile';
import type { TwinTone } from '@/lib/bindings/TwinTone';
import type { TwinChannel } from '@/lib/bindings/TwinChannel';
import type { TwinVoiceProfile } from '@/lib/bindings/TwinVoiceProfile';
import type { TwinPendingMemory } from '@/lib/bindings/TwinPendingMemory';

// Pure-function tests. The hook's effect side covers fetch wiring; the
// reducer-shaped derivation here is what every cycle 1 / 12-16 surface
// reads, so pinning its semantics keeps the gap popover + selector strip
// + recall preview honest across future refactors.

function makeProfile(over: Partial<TwinProfile> = {}): TwinProfile {
  return {
    id: 't1',
    name: 'Test Twin',
    slug: 'test-twin',
    bio: null,
    role: null,
    languages: null,
    pronouns: null,
    obsidian_subpath: '',
    is_active: true,
    knowledge_base_id: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...over,
  };
}

function makeTone(over: Partial<TwinTone> = {}): TwinTone {
  return {
    id: 'tn',
    twin_id: 't1',
    channel: 'generic',
    voice_directives: 'casual',
    examples_json: null,
    constraints_json: null,
    length_hint: null,
    updated_at: '',
    ...over,
  };
}

function makeChannel(over: Partial<TwinChannel> = {}): TwinChannel {
  return {
    id: 'c1',
    twin_id: 't1',
    channel_type: 'discord',
    credential_id: 'cred-1',
    persona_id: null,
    label: null,
    is_active: true,
    created_at: '',
    updated_at: '',
    ...over,
  };
}

function makeMem(over: Partial<TwinPendingMemory> = {}): TwinPendingMemory {
  return {
    id: 'm1',
    twin_id: 't1',
    channel: null,
    content: 'x',
    title: null,
    importance: 3,
    status: 'approved',
    reviewer_notes: null,
    source_communication_id: null,
    created_at: '',
    reviewed_at: null,
    ...over,
  };
}

function voiceWith(voice_id: string): TwinVoiceProfile {
  return {
    id: 'v1',
    twin_id: 't1',
    provider: 'elevenlabs',
    credential_id: null,
    voice_id,
    model_id: null,
    stability: 0.5,
    similarity_boost: 0.75,
    style: 0,
    updated_at: '',
  };
}

describe('deriveReadiness', () => {
  it('empty twin returns all-empty milestones and score 0', () => {
    const r = deriveReadiness(makeProfile(), [], [], null, []);
    expect(r.identity).toBe('empty');
    expect(r.tone).toBe('empty');
    expect(r.brain).toBe('empty');
    expect(r.voice).toBe('empty');
    expect(r.channels).toBe('empty');
    expect(r.memories).toBe('empty');
    expect(r.score).toBe(0);
  });

  it('short bio is partial; bio ≥ 50 chars is complete', () => {
    const short = deriveReadiness(makeProfile({ bio: 'hi' }), [], [], null, []);
    expect(short.identity).toBe('partial');
    const long = deriveReadiness(
      makeProfile({ bio: 'a'.repeat(60) }),
      [], [], null, [],
    );
    expect(long.identity).toBe('complete');
  });

  it('generic-only tone is partial; channel-specific tone is complete', () => {
    const genericOnly = deriveReadiness(
      makeProfile(),
      [makeTone({ channel: 'generic' })],
      [], null, [],
    );
    expect(genericOnly.tone).toBe('partial');
    const specific = deriveReadiness(
      makeProfile(),
      [makeTone({ channel: 'generic' }), makeTone({ id: 'tn2', channel: 'discord' })],
      [], null, [],
    );
    expect(specific.tone).toBe('complete');
  });

  it('subpath-only brain is partial; KB-bound is complete', () => {
    const subpathOnly = deriveReadiness(
      makeProfile({ obsidian_subpath: 'twins/x' }),
      [], [], null, [],
    );
    expect(subpathOnly.brain).toBe('partial');
    const kbBound = deriveReadiness(
      makeProfile({ knowledge_base_id: 'kb-1' }),
      [], [], null, [],
    );
    expect(kbBound.brain).toBe('complete');
  });

  it('voice complete only when voice_id is non-empty', () => {
    expect(
      deriveReadiness(makeProfile(), [], [], voiceWith(''), []).voice,
    ).toBe('empty');
    expect(
      deriveReadiness(makeProfile(), [], [], voiceWith('   '), []).voice,
    ).toBe('empty');
    expect(
      deriveReadiness(makeProfile(), [], [], voiceWith('eleven-xyz'), []).voice,
    ).toBe('complete');
  });

  it('channels: paused-only is partial, any active is complete', () => {
    const allPaused = deriveReadiness(
      makeProfile(), [],
      [makeChannel({ is_active: false }), makeChannel({ id: 'c2', is_active: false })],
      null, [],
    );
    expect(allPaused.channels).toBe('partial');
    expect(allPaused.counts.channelsTotal).toBe(2);
    expect(allPaused.counts.channelsActive).toBe(0);

    const oneActive = deriveReadiness(
      makeProfile(), [],
      [makeChannel({ is_active: false }), makeChannel({ id: 'c2', is_active: true })],
      null, [],
    );
    expect(oneActive.channels).toBe('complete');
    expect(oneActive.counts.channelsActive).toBe(1);
  });

  it('memories: 0 = empty, 1–4 approved = partial, ≥5 = complete', () => {
    const one = deriveReadiness(
      makeProfile(), [], [], null,
      [makeMem({ id: 'a', status: 'approved' })],
    );
    expect(one.memories).toBe('partial');
    expect(one.counts.memoriesApproved).toBe(1);

    const five = deriveReadiness(
      makeProfile(), [], [], null,
      Array.from({ length: 5 }, (_, i) => makeMem({ id: `a${i}`, status: 'approved' })),
    );
    expect(five.memories).toBe('complete');

    // Rejected/pending entries don't count toward "complete" but do toward counts.
    const mixed = deriveReadiness(
      makeProfile(), [], [], null,
      [
        makeMem({ id: '1', status: 'approved' }),
        makeMem({ id: '2', status: 'pending' }),
        makeMem({ id: '3', status: 'pending' }),
      ],
    );
    expect(mixed.memories).toBe('partial');
    expect(mixed.counts.memoriesApproved).toBe(1);
    expect(mixed.counts.memoriesPending).toBe(2);
  });

  it('score is the rounded average of six milestones (complete=1, partial=0.5, empty=0)', () => {
    // All six complete → 100.
    const full = deriveReadiness(
      makeProfile({ bio: 'a'.repeat(60), knowledge_base_id: 'kb-1' }),
      [makeTone({ channel: 'discord' })],
      [makeChannel({ is_active: true })],
      voiceWith('v-1'),
      Array.from({ length: 5 }, (_, i) => makeMem({ id: `m${i}`, status: 'approved' })),
    );
    expect(full.score).toBe(100);

    // Identity complete, all others empty → 1/6 → round(16.67) = 17.
    const oneComplete = deriveReadiness(
      makeProfile({ bio: 'a'.repeat(60) }),
      [], [], null, [],
    );
    expect(oneComplete.score).toBe(17);
  });
});
