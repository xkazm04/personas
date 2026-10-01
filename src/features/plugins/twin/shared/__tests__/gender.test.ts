import { describe, expect, it } from 'vitest';

import { genderFromPronouns } from '../gender';

describe('genderFromPronouns', () => {
  it('reads she/her as female (it contains "he/" and used to read as male)', () => {
    expect(genderFromPronouns('she/her')).toBe('female');
    expect(genderFromPronouns('She/Her')).toBe('female');
  });

  it('reads he/him and the stored tokens', () => {
    expect(genderFromPronouns('he/him')).toBe('male');
    expect(genderFromPronouns('male')).toBe('male');
    expect(genderFromPronouns('female')).toBe('female');
  });

  it('falls back to neutral', () => {
    expect(genderFromPronouns('they/them')).toBe('neutral');
    expect(genderFromPronouns('neutral')).toBe('neutral');
    expect(genderFromPronouns(null)).toBe('neutral');
  });
});
