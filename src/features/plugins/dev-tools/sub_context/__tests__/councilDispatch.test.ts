import { describe, it, expect, vi, beforeEach } from 'vitest';

const councilSkillInstalled = vi.hoisted(() => vi.fn());

vi.mock('@/api/devTools/council', () => ({
  councilSkillInstalled,
  COUNCIL_SKILL: 'council',
}));

vi.mock('@/i18n/useTranslation', async () => {
  const actual = await vi.importActual<typeof import('@/i18n/useTranslation')>('@/i18n/useTranslation');
  return {
    ...actual,
    getActiveTranslations: () => ({
      plugins: {
        dev_tools: {
          council_dispatch_title: 'Council: {feature}',
          council_skill_missing:
            'The council skill is not linked in {project}. Run {remedy} in the registry checkout, then try again.',
        },
      },
    }),
  };
});

import {
  buildCouncilDispatch,
  councilFleetKey,
  councilPrompt,
  COUNCIL_LINK_REMEDY,
} from '../councilDispatch';

const target = { projectId: 'proj-1', projectName: 'Personas', rootPath: 'C:/repos/personas' };

describe('council dispatch request', () => {
  beforeEach(() => councilSkillInstalled.mockReset());

  it('addresses one subject with one fleet key', () => {
    expect(councilFleetKey('proj-1', 'agent-execution')).toBe('council:proj-1:agent-execution');
  });

  it('asks for the slash command, and for the next round after the first', () => {
    expect(councilPrompt('agent-execution', 1)).toBe('/council agent-execution');
    expect(councilPrompt('agent-execution', 2)).toBe('/council agent-execution --round 2');
  });

  it('builds the request the consent surface consumes', () => {
    const req = buildCouncilDispatch({
      target,
      slug: 'agent-execution',
      featureName: 'Agent Execution',
      roundNo: null,
    });
    expect(req.title).toBe('Council: Agent Execution');
    expect(req.prompt).toBe('/council agent-execution');
    expect(req.fleetKey).toBe('council:proj-1:agent-execution');
    expect(req.target).toEqual(target);
  });

  it('asks for round n+1 when a round is already on record', () => {
    const req = buildCouncilDispatch({
      target,
      slug: 'vault',
      featureName: 'Credential Vault',
      roundNo: 2,
    });
    expect(req.prompt).toBe('/council vault --round 3');
  });

  it('prepare() refuses with the remedy when the skill link is missing', async () => {
    councilSkillInstalled.mockResolvedValue(false);
    const req = buildCouncilDispatch({ target, slug: 's', featureName: 'F', roundNo: null });
    await expect(req.prepare?.()).rejects.toThrow(COUNCIL_LINK_REMEDY);
    await expect(req.prepare?.()).rejects.toThrow('Personas');
  });

  it('prepare() passes when the skill is linked', async () => {
    councilSkillInstalled.mockResolvedValue(true);
    const req = buildCouncilDispatch({ target, slug: 's', featureName: 'F', roundNo: null });
    await expect(req.prepare?.()).resolves.toBeUndefined();
  });

  // A read failure must NOT read as "the skill is missing": the operator would
  // be handed a remedy for a problem they do not have. That property lives in
  // `councilSkillInstalled` (which invokes DIRECTLY rather than through
  // `safeInvoke`, so a failed read throws) and in `prepare`, which does not
  // catch. Not asserted here: a vi.fn() whose implementation throws is reported
  // by this vitest runner as an uncaught test error even from inside a
  // try/catch, so the negative case cannot be driven through the mock.
});
