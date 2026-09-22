import { describe, it, expect } from 'vitest';
import type { ResponsibilitySpec } from '@/lib/bindings/ResponsibilitySpec';
import type { ResourceProfile } from '@/lib/bindings/ResourceProfile';
import {
  DEFAULT_PROFILE_DRAFT,
  mergeSpec,
  profileDraftOf,
  specWithParameterValues,
  specWithResourceProfile,
} from '../libs/charterSpec';

const selfDeclared: ResourceProfile = {
  machine: 'heavy',
  gpu: 'shared',
  difficulty: 'hard',
  effort: 'l',
  source: 'self',
  pinned: false,
  rationale: 'builds the whole workspace',
  declaredAt: '2026-09-17T10:00:00Z',
};

describe('charter spec: resource profile', () => {
  it('an untouched save omits the profile, so the door keeps the stored one', () => {
    const spec: ResponsibilitySpec = { modelOverride: 'opus', resourceProfile: selfDeclared };
    const viaMerge = mergeSpec(spec, { memoryPolicy: { enabled: true } });
    const viaParams = specWithParameterValues(spec, { channel: 'ops' });
    expect('resourceProfile' in viaMerge).toBe(false);
    expect('resourceProfile' in viaParams).toBe(false);
    // Everything else still rides along: the spec column is replaced whole.
    expect(viaMerge.modelOverride).toBe('opus');
    expect(viaParams.sampleInput).toEqual({ channel: 'ops' });
  });

  it('an edit carries the profile pinned, and drops the stale rationale', () => {
    const spec: ResponsibilitySpec = { resourceProfile: selfDeclared };
    const next = specWithResourceProfile(spec, { ...profileDraftOf(spec), effort: 'xl', pinned: true });
    expect(next.resourceProfile).toMatchObject({
      machine: 'heavy',
      gpu: 'shared',
      difficulty: 'hard',
      effort: 'xl',
      pinned: true,
      rationale: null,
    });
    // Provenance is stamped by the server: nothing stored is echoed back.
    expect(next.resourceProfile?.declaredAt).toBeNull();
    expect(next.resourceProfile?.source).not.toBe('self');
  });

  it('unpinning sends pinned:false and keeps the rationale the tags still match', () => {
    const pinned: ResourceProfile = { ...selfDeclared, source: 'operator', pinned: true };
    const spec: ResponsibilitySpec = { resourceProfile: pinned };
    const next = specWithResourceProfile(spec, { ...profileDraftOf(spec), pinned: false });
    expect(next.resourceProfile?.pinned).toBe(false);
    expect(next.resourceProfile?.rationale).toBe('builds the whole workspace');
  });

  it('an untagged charter reads as the default, and an unknown tag degrades to it', () => {
    expect(profileDraftOf({})).toEqual(DEFAULT_PROFILE_DRAFT);
    // INVARIANT under test: the spec is a DB blob a model can write, so a tag
    // outside the vocabulary must not reach a picker that has no option for it.
    // The cast only types the fixture; `profileDraftOf` is what narrows it.
    const rogue = JSON.parse('{"resourceProfile":{"machine":"colossal","effort":"xl"}}') as ResponsibilitySpec;
    expect(profileDraftOf(rogue)).toEqual({ ...DEFAULT_PROFILE_DRAFT, effort: 'xl' });
  });
});
