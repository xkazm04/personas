import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { buildPrContent, IDEA_SCALE_MAX } from '../PrBridge';
import type { DevTask } from '@/lib/bindings/DevTask';
import type { DevIdea } from '@/lib/bindings/DevIdea';

/** The Rust constant every stored effort/impact/risk is normalised onto. */
function rustIdeaScaleMax(): number {
  const raw = readFileSync(resolve(process.cwd(), 'src-tauri/core/src/models/dev_tools.rs'), 'utf8');
  const code = raw.replace(/\/\/.*$/gm, '');
  const m = /pub const IDEA_SCALE_MAX:\s*i32\s*=\s*(\d+)\s*;/.exec(code);
  if (!m) throw new Error('IDEA_SCALE_MAX not found in dev_tools.rs');
  return Number(m[1]);
}

const task = { id: 'task-1234567', title: 'Fix login', description: null } as unknown as DevTask;
const idea = {
  id: 'idea-1', title: 'Fix login', scan_type: 'unknown-agent', category: 'bug',
  effort: 2, impact: 5, risk: 4, description: 'd', reasoning: null,
} as unknown as DevIdea;

describe('PR body idea scores', () => {
  it('the TS scale mirrors the Rust IDEA_SCALE_MAX', () => {
    expect(IDEA_SCALE_MAX).toBe(rustIdeaScaleMax());
  });

  it('prints each score out of the stored scale, never out of ten', () => {
    const { prBody } = buildPrContent(task, idea, 'task-12', '{label} {emoji}');
    expect(prBody).toContain(`**Effort:** 2/${rustIdeaScaleMax()}`);
    expect(prBody).toContain(`**Impact:** 5/${rustIdeaScaleMax()}`);
    expect(prBody).toContain(`**Risk:** 4/${rustIdeaScaleMax()}`);
    expect(prBody).not.toMatch(/\/10\b/);
  });
});
