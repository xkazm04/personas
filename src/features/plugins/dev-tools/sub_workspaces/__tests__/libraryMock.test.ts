import { describe, it, expect } from 'vitest';

import { generateMockLibrary } from '../libraryMock';

describe('generateMockLibrary', () => {
  it('is deterministic per workspace id (seeded)', () => {
    const a = generateMockLibrary('ws-1', ['p1', 'p2'], 40);
    const b = generateMockLibrary('ws-1', ['p1', 'p2'], 40);
    expect(a.map((i) => i.id)).toEqual(b.map((i) => i.id));
    expect(a.map((i) => i.title)).toEqual(b.map((i) => i.title));
  });

  it('varies across workspaces', () => {
    const a = generateMockLibrary('ws-1', [], 40);
    const b = generateMockLibrary('ws-2', [], 40);
    expect(a.map((i) => i.title)).not.toEqual(b.map((i) => i.title));
  });

  it('flags every row as mock and never emits real-looking ids', () => {
    const rows = generateMockLibrary('ws-1', ['p1'], 30);
    expect(rows.every((r) => r.mock === true)).toBe(true);
    expect(rows.every((r) => r.id.startsWith('mock-'))).toBe(true);
  });

  it('only assigns origins from the given member set (or null)', () => {
    const members = ['p1', 'p2'];
    const rows = generateMockLibrary('ws-1', members, 60);
    for (const r of rows) {
      if (r.originProjectId !== null) expect(members).toContain(r.originProjectId);
    }
  });

  it('produces emergent multi-level topics and valid timestamps', () => {
    const rows = generateMockLibrary('ws-1', ['p1'], 80);
    expect(rows.some((r) => r.topic.includes('/'))).toBe(true);
    for (const r of rows) {
      expect(Number.isNaN(Date.parse(r.createdAt))).toBe(false);
      // updated never precedes created
      expect(Date.parse(r.updatedAt)).toBeGreaterThanOrEqual(Date.parse(r.createdAt));
    }
  });
});
