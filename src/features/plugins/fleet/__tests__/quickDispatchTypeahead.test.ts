import { describe, expect, it } from 'vitest';
import {
  activeTypeaheadToken,
  dispatchIntentOf,
  filterQuickDispatchProjects,
  filterQuickDispatchSkills,
  stripActiveToken,
} from '../quick-dispatch/quickDispatchTypeahead';
import type { DevProject, SkillEntry } from '@/api/devTools/devTools';

const project = (name: string, root: string): DevProject =>
  ({ id: name, name, root_path: root } as unknown as DevProject); // test double: only the fields the filter reads

const skill = (name: string, description: string | null = null): SkillEntry =>
  ({ name, path: `.claude/skills/${name}`, description } as unknown as SkillEntry); // test double: only the fields the filter reads

describe('activeTypeaheadToken', () => {
  it('opens the project typeahead on a leading @ token', () => {
    expect(activeTypeaheadToken('@per')).toEqual({ kind: 'project', query: 'per', start: 0 });
  });

  it('opens the skill typeahead on a / token after whitespace', () => {
    expect(activeTypeaheadToken('fix the bug /re')).toEqual({
      kind: 'skill',
      query: 're',
      start: 12,
    });
  });

  it('yields an empty query right after the sigil', () => {
    expect(activeTypeaheadToken('do it @')).toEqual({ kind: 'project', query: '', start: 6 });
  });

  it('does NOT trigger on mid-token sigils (emails, paths)', () => {
    expect(activeTypeaheadToken('mail user@example.com')).toBeNull();
    expect(activeTypeaheadToken('edit src/foo.ts')).toBeNull();
  });

  it('only the LAST token counts', () => {
    expect(activeTypeaheadToken('@personas fix things')).toBeNull();
  });
});

describe('stripActiveToken', () => {
  it('removes the token and its trailing whitespace', () => {
    expect(stripActiveToken('fix the bug @per')).toBe('fix the bug');
  });

  it('leaves a token-free draft untouched', () => {
    expect(stripActiveToken('fix the bug')).toBe('fix the bug');
  });
});

describe('filterQuickDispatchProjects', () => {
  const projects = [
    project('personas', 'C:/dev/personas'),
    project('pumper', 'C:/dev/pumper'),
    project('ai-registry', 'C:/dev/ai-registry'),
  ];

  it('lists everything (capped) on an empty query', () => {
    expect(filterQuickDispatchProjects(projects, '')).toHaveLength(3);
  });

  it('ranks a name prefix match first and drops non-matches', () => {
    const got = filterQuickDispatchProjects(projects, 'pers');
    expect(got[0]?.name).toBe('personas');
    expect(got.map((p) => p.name)).not.toContain('ai-registry');
  });

  it('matches on the root path as a secondary signal', () => {
    const got = filterQuickDispatchProjects(projects, 'dev/pum');
    expect(got.map((p) => p.name)).toContain('pumper');
  });

  it('respects the max cap', () => {
    expect(filterQuickDispatchProjects(projects, '', 2)).toHaveLength(2);
  });
});

describe('filterQuickDispatchSkills', () => {
  const skills = [
    skill('research', 'Extract improvements from sources'),
    skill('code-review', 'Production-readiness review'),
    skill('uat', null),
  ];

  it('matches by name', () => {
    expect(filterQuickDispatchSkills(skills, 'rese')[0]?.name).toBe('research');
  });

  it('matches by description as a secondary signal', () => {
    expect(filterQuickDispatchSkills(skills, 'readiness').map((s) => s.name)).toContain(
      'code-review',
    );
  });

  it('returns everything on an empty query', () => {
    expect(filterQuickDispatchSkills(skills, '')).toHaveLength(3);
  });
});

describe('dispatchIntentOf', () => {
  it('takes the first non-empty line', () => {
    expect(dispatchIntentOf('\n  fix the parser\nand then some detail')).toBe('fix the parser');
  });

  it('clamps to the server intent bound', () => {
    expect(dispatchIntentOf('x'.repeat(400), 300)).toHaveLength(300);
  });

  it('is empty for a blank requirement', () => {
    expect(dispatchIntentOf('   \n  ')).toBe('');
  });
});
