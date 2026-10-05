// Every tech token the Server control harness tape carries resolves to a brand
// icon, so no variant is judged on a fallback text chip it would never show
// for a real stack. The tape is the fixture the screenshots are shot on.
import { describe, expect, it } from 'vitest';

import { resolveTechIcon } from '@/features/teams/sub_factory/passport/techIcons';

import { techTokens } from '../serverModel';
// @ts-expect-error -- plain .mjs fixture module, no declaration file
import { serverControlTapes } from '../../../../../scripts/style/page-harness/serverControlTapes.mjs';

const { SERVERS } = serverControlTapes({ RECORDED_AT: '2026-10-05T12:00:00Z' }) as {
  SERVERS: { techStack: string | null }[];
};
const TOKENS = [...new Set(SERVERS.flatMap((s) => techTokens(s)))].sort();

describe('tech icons for the server tape', () => {
  it('the tape carries a stack to check', () => {
    expect(TOKENS.length).toBeGreaterThan(10);
  });

  it.each(TOKENS)('%s resolves to an icon', (token) => {
    expect(resolveTechIcon(token)).not.toBeNull();
  });

  it.each([
    ['Vite', 'Vite'],
    ['Bun', 'Bun'],
    ['Python', 'Python'],
    ['Node.js', 'Node.js'],
    ['PostgreSQL', 'PostgreSQL'],
    ['Postgres', 'PostgreSQL'],
  ])('%s is the %s mark', (label, title) => {
    expect(resolveTechIcon(label)?.icon.title).toBe(title);
  });
});
