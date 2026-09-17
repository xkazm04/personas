/**
 * The sensor → library join. `emitSkillDormantFindings` has ranked dormant
 * skills for two phases and Skills Overview never read a single one, so the
 * assertion that matters is the first: N recommended rows for N pending
 * `skill_dormant` findings, and nothing for anything else in the queue.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { DevIdea } from '@/lib/bindings/DevIdea';

import { parseDormantFindings, DORMANT_ORIGIN } from '../dormantSkillFindings';
import { DormantSkillsStrip } from '../DormantSkillsStrip';

function idea(over: Partial<DevIdea>): DevIdea {
  return {
    id: 'i1',
    project_id: 'p1',
    context_id: null,
    scan_type: 'findings',
    category: 'maintainability',
    title: 'Dormant skill',
    description: null,
    reasoning: null,
    status: 'pending',
    effort: 1,
    impact: 2,
    risk: 1,
    priority: null,
    provider: null,
    model: null,
    rejection_reason: null,
    origin: DORMANT_ORIGIN,
    use_case_id: null,
    evidence: JSON.stringify({ skillName: 'docs-lint', scope: 'project', lastInvokedAt: null }),
    dedup_key: 'skill:project:docs-lint',
    goal_id: null,
    verify_state: null,
    verify_checked_at: null,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    ...over,
  };
}

const ev = (skillName: string, lastInvokedAt: string | null = null) =>
  JSON.stringify({ skillName, scope: 'project', lastInvokedAt });

describe('parseDormantFindings', () => {
  it('picks exactly the pending skill_dormant findings', () => {
    const rows = parseDormantFindings([
      idea({ id: 'a', evidence: ev('docs-lint') }),
      idea({ id: 'b', evidence: ev('perf-audit', '2026-06-01T00:00:00Z') }),
      // Another sensor's finding in the same queue.
      idea({ id: 'c', origin: 'llm_cost', evidence: JSON.stringify({ useCaseName: 'x' }) }),
      // A classic Idea-Scanner idea (no origin at all).
      idea({ id: 'd', origin: null, evidence: null }),
    ]);
    expect(rows.map((r) => r.skillName)).toEqual(['docs-lint', 'perf-audit']);
    expect(rows[0].lastInvokedAt).toBeNull();
    expect(rows[1].lastInvokedAt).toBe('2026-06-01T00:00:00Z');
  });

  it('status is the authority — a decided finding is not a recommendation', () => {
    const rows = parseDormantFindings([
      idea({ id: 'a', status: 'accepted', evidence: ev('gone') }),
      idea({ id: 'b', status: 'rejected', evidence: ev('also-gone') }),
      idea({ id: 'c', status: 'pending', evidence: ev('here') }),
    ]);
    expect(rows.map((r) => r.skillName)).toEqual(['here']);
  });

  it('drops a finding it cannot name a skill for rather than showing a blank row', () => {
    const rows = parseDormantFindings([
      idea({ id: 'a', evidence: 'not json at all' }),
      idea({ id: 'b', evidence: null }),
      idea({ id: 'c', evidence: JSON.stringify({ scope: 'project' }) }),
      idea({ id: 'd', evidence: JSON.stringify(['an', 'array']) }),
      idea({ id: 'e', evidence: ev('survivor') }),
    ]);
    expect(rows.map((r) => r.skillName)).toEqual(['survivor']);
  });
});

describe('DormantSkillsStrip', () => {
  const findings = parseDormantFindings([
    idea({ id: 'a', evidence: ev('docs-lint') }),
    idea({ id: 'b', evidence: ev('perf-audit', '2026-06-01T00:00:00Z') }),
  ]);

  it('renders one row per finding for an installed skill', () => {
    render(
      <DormantSkillsStrip
        findings={findings}
        installedNames={new Set(['docs-lint', 'perf-audit', 'something-used'])}
        onUse={() => {}}
      />,
    );
    expect(screen.getByTestId('dormant-skills-count').textContent).toBe('2');
    expect(screen.getByTestId('dormant-skill-docs-lint')).toBeTruthy();
    expect(screen.getByTestId('dormant-skill-perf-audit')).toBeTruthy();
  });

  it('a finding whose skill has since been removed is not offered', () => {
    render(
      <DormantSkillsStrip findings={findings} installedNames={new Set(['docs-lint'])} onUse={() => {}} />,
    );
    expect(screen.getByTestId('dormant-skills-count').textContent).toBe('1');
    expect(screen.queryByTestId('dormant-skill-perf-audit')).toBeNull();
  });

  it('renders nothing at all when the sweep has raised none', () => {
    render(<DormantSkillsStrip findings={[]} installedNames={new Set(['docs-lint'])} onUse={() => {}} />);
    expect(screen.queryByTestId('dormant-skills-strip')).toBeNull();
  });

  it('the action dispatches the named skill', () => {
    const onUse = vi.fn();
    render(
      <DormantSkillsStrip findings={findings} installedNames={new Set(['docs-lint'])} onUse={onUse} />,
    );
    fireEvent.click(screen.getByTestId('dormant-skill-use-docs-lint'));
    expect(onUse).toHaveBeenCalledWith('docs-lint');
  });
});
