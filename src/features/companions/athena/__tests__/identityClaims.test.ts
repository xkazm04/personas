import { describe, expect, it } from 'vitest';
import { parseIdentityClaims } from '../identityClaims';

const seeded = `---
type: identity
---

# About Michal

## How he works
- likes terse replies (ep_aa11)
- (rhythms, patterns)

# About me

## What I've gotten wrong
- assumed he wanted long answers
`;

const otherName = `# About Alex

## How she works
- reviews in the morning (ep_bb22)

# About me

## What I've gotten wrong
- guessed at her timezone
`;

const untitled = `## Working style
- ships small commits (ep_cc33)
`;

describe('parseIdentityClaims', () => {
  it('collects the operator profile bullets from the seeded heading', () => {
    const claims = parseIdentityClaims(seeded);
    expect(claims).toEqual([
      { section: 'About Michal / How he works', bullet: 'likes terse replies (ep_aa11)' },
    ]);
  });

  it('collects them for any other operator name', () => {
    const claims = parseIdentityClaims(otherName);
    expect(claims).toEqual([
      { section: 'About Alex / How she works', bullet: 'reviews in the morning (ep_bb22)' },
    ]);
  });

  it('treats a document with no top-level heading as one untitled profile', () => {
    const claims = parseIdentityClaims(untitled);
    expect(claims).toEqual([
      { section: 'Working style', bullet: 'ships small commits (ep_cc33)' },
    ]);
  });

  it("never offers the companion's own self-model as a correctable claim", () => {
    for (const md of [seeded, otherName]) {
      expect(parseIdentityClaims(md).some((c) => c.section.startsWith('About me'))).toBe(false);
    }
  });
});
