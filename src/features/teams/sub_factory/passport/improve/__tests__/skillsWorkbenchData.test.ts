import { describe, expect, it } from 'vitest';

import {
  BATCH_BRIEF_PATH, consolePrompt, skillCommand, usageHint,
} from '../skillsWorkbenchData';

describe('skillsWorkbenchData — pure helpers', () => {
  it('skillCommand builds a slash command, args optional + trimmed', () => {
    expect(skillCommand('kpi-sim', '')).toBe('/kpi-sim');
    expect(skillCommand('kpi-sim', '   ')).toBe('/kpi-sim');
    expect(skillCommand('kpi-sim', '  run --l2 ')).toBe('/kpi-sim run --l2');
  });

  it('usageHint prefers a backticked slash-command span', () => {
    expect(usageHint('Measures KPIs. Invoke with `/kpi-sim run [--l2]`.')).toBe('/kpi-sim run [--l2]');
  });

  it('usageHint falls back to an "Invoke with" clause, else null', () => {
    expect(usageHint('Does a thing. Invoke with /uat run args here. More text.')).toBe('/uat run args here');
    expect(usageHint('A plain description with no invocation line.')).toBeNull();
    expect(usageHint(null)).toBeNull();
  });
});

describe('skillsWorkbenchData — consolePrompt', () => {
  it('a single run stays a bare slash command so the CLI recognizes it', () => {
    expect(consolePrompt('perfect', ['ship-layer'])).toEqual({ prompt: '/perfect ship-layer', brief: null });
    // no arg sets at all behaves like one empty set, not an empty batch
    expect(consolePrompt('perfect', [])).toEqual({ prompt: '/perfect', brief: null });
  });

  it('a batch becomes ONE prose prompt listing every command, run sequentially', () => {
    const { prompt, brief } = consolePrompt('perfect', ['alpha', 'beta', 'gamma']);
    expect(brief).toBeNull();
    expect(prompt).toContain('3 times');
    expect(prompt).toContain('IN ORDER');
    expect(prompt).toContain('do not run them in parallel');
    for (const c of ['- /perfect alpha', '- /perfect beta', '- /perfect gamma']) {
      expect(prompt).toContain(c);
    }
    // NOT a slash command: leading-slash text would swallow the rest as args
    expect(prompt.startsWith('/')).toBe(false);
  });

  it('a batch too large to inline travels as a brief file instead', () => {
    const many = Array.from({ length: 800 }, (_, i) => `context-number-${i}`);
    const { prompt, brief } = consolePrompt('perfect', many);
    expect(brief).not.toBeNull();
    expect(prompt).toContain(BATCH_BRIEF_PATH);
    // the ceiling this guards is the ~32 KB Windows command line
    expect(prompt.length).toBeLessThan(4500);
    expect(brief).toContain('/perfect context-number-799');
    expect(brief).toContain('800 runs');
  });
});
