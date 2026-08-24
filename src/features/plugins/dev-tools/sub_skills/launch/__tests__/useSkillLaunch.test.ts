// Pure-helper tests for the Skill Launch data spine. The hook itself is not
// rendered — status derivation and the running-session matcher are exported
// pure functions and tested directly.
import { describe, expect, it } from 'vitest';

import {
  argsInvokeSkill, composeLaunchAsk, deriveLaunchStatus,
  launchKey, normPath, sessionRunsSkill,
} from '../useSkillLaunch';
import type { DevProject } from '@/lib/bindings/DevProject';

describe('deriveLaunchStatus', () => {
  it('returns running above everything else', () => {
    expect(deriveLaunchStatus({ running: true, adopting: true, installed: true })).toBe('running');
    expect(deriveLaunchStatus({ running: true, adopting: false, installed: false })).toBe('running');
  });

  it('returns adopting above installed', () => {
    expect(deriveLaunchStatus({ running: false, adopting: true, installed: true })).toBe('adopting');
    expect(deriveLaunchStatus({ running: false, adopting: true, installed: false })).toBe('adopting');
  });

  it('returns ready when installed and idle', () => {
    expect(deriveLaunchStatus({ running: false, adopting: false, installed: true })).toBe('ready');
  });

  it('returns needs_adopt when nothing applies', () => {
    expect(deriveLaunchStatus({ running: false, adopting: false, installed: false })).toBe('needs_adopt');
  });
});

describe('argsInvokeSkill', () => {
  it('matches the first-arg slash command with trailing args (parseSkillArg lane)', () => {
    expect(argsInvokeSkill(['/perfect build core'], 'perfect')).toBe(true);
    expect(argsInvokeSkill(['/perfect'], 'perfect')).toBe(true);
  });

  it('matches a bare /skill token in any position (Athena-dispatched shape)', () => {
    expect(argsInvokeSkill(['--resume', '/scan-sweep'], 'scan-sweep')).toBe(true);
  });

  it('matches an arg that contains "/skill " mid-string', () => {
    expect(argsInvokeSkill(['run /kpi-sim predict now'], 'kpi-sim')).toBe(true);
  });

  it('does not match a different skill or a prefix collision', () => {
    expect(argsInvokeSkill(['/perfect build'], 'scan-sweep')).toBe(false);
    // '/scan' must not match '/scan-sweep ...' args.
    expect(argsInvokeSkill(['/scan-sweep ui'], 'scan')).toBe(false);
    expect(argsInvokeSkill([], 'perfect')).toBe(false);
    expect(argsInvokeSkill(['perfect'], 'perfect')).toBe(false);
  });
});

describe('sessionRunsSkill', () => {
  const root = 'C:\\Users\\dev\\repo';
  const base = { args: ['/perfect build'], cwd: 'c:/users/dev/repo/', state: 'running' };

  it('matches a live session with normalized cwd and the skill arg', () => {
    expect(sessionRunsSkill(base, 'perfect', root)).toBe(true);
    expect(sessionRunsSkill({ ...base, state: 'spawning' }, 'perfect', root)).toBe(true);
    expect(sessionRunsSkill({ ...base, state: 'awaiting_input' }, 'perfect', root)).toBe(true);
  });

  it('rejects settled states', () => {
    expect(sessionRunsSkill({ ...base, state: 'idle' }, 'perfect', root)).toBe(false);
    expect(sessionRunsSkill({ ...base, state: 'exited' }, 'perfect', root)).toBe(false);
  });

  it('rejects a different cwd', () => {
    expect(sessionRunsSkill({ ...base, cwd: 'C:/Users/dev/other' }, 'perfect', root)).toBe(false);
  });

  it('rejects a different skill in the same cwd', () => {
    expect(sessionRunsSkill(base, 'scan-sweep', root)).toBe(false);
  });
});

describe('normPath / launchKey', () => {
  it('normalizes separators, case, and trailing slashes', () => {
    expect(normPath('C:\\A\\B\\')).toBe(normPath('c:/a/b'));
  });

  it('keys a cell by skill and project id', () => {
    expect(launchKey('perfect', 'p1')).toBe('perfect:p1');
  });
});

describe('composeLaunchAsk', () => {
  const project = { name: 'Repo', root_path: 'C:/dev/repo' } as DevProject; // only the two fields the ask reads

  it('states the user action, skill, project and cwd - nothing leading', () => {
    const ask = composeLaunchAsk('perfect', project, null);
    expect(ask).toContain('The user clicked Launch');
    expect(ask).toContain('/perfect');
    expect(ask).toContain('"Repo"');
    expect(ask).toContain('cwd: C:/dev/repo');
    // Non-leading by design: no dictated objective, no scripted questioning.
    expect(ask).not.toContain('objective:');
    expect(ask).not.toContain('ask me');
  });

  it('carries the declared argument syntax when the skill has one', () => {
    const ask = composeLaunchAsk('conform', project, '[context-or-path] [--budget <n>]');
    expect(ask).toContain('/conform [context-or-path] [--budget <n>]');
    expect(composeLaunchAsk('conform', project, null)).not.toContain('argument syntax');
  });
});
