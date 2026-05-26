import { describe, it, expect, beforeEach } from 'vitest';
import { WALKTHROUGHS, GUIDANCE_TOPICS, getWalkthrough } from '../walkthroughs';
import { useCompanionStore } from '../../companionStore';

describe('walkthroughs registry', () => {
  it('exposes persona_creation with ordered steps', () => {
    const wt = WALKTHROUGHS.persona_creation;
    expect(wt).toBeDefined();
    expect(wt!.topic).toBe('persona_creation');
    expect(wt!.steps.length).toBeGreaterThanOrEqual(4);
    // Every step has a stable id and a narration resolver.
    for (const step of wt!.steps) {
      expect(typeof step.id).toBe('string');
      expect(typeof step.narration).toBe('function');
    }
  });

  it('points the build steps at the persona-build anchors (Phase 4 testids)', () => {
    const ids = WALKTHROUGHS.persona_creation!.steps
      .map((s) => s.highlightTestId)
      .filter(Boolean);
    expect(ids).toContain('persona-build-entry');
    expect(ids).toContain('persona-intent-input');
    expect(ids).toContain('persona-build-launch');
  });

  it('lists persona_creation in GUIDANCE_TOPICS (backend allow-list mirror)', () => {
    expect(GUIDANCE_TOPICS).toContain('persona_creation');
  });

  it('getWalkthrough resolves known topics and rejects unknown/null', () => {
    expect(getWalkthrough('persona_creation')?.topic).toBe('persona_creation');
    expect(getWalkthrough('nope')).toBeNull();
    expect(getWalkthrough(null)).toBeNull();
  });
});

describe('companionStore guidance actions', () => {
  beforeEach(() => {
    useCompanionStore.getState().stopGuidance();
  });

  it('startGuidance activates a topic at step 0, playing', () => {
    useCompanionStore.getState().startGuidance('persona_creation');
    const s = useCompanionStore.getState();
    expect(s.activeWalkthrough).toBe('persona_creation');
    expect(s.guidanceStepIndex).toBe(0);
    expect(s.guidancePlaying).toBe(true);
  });

  it('advanceGuidance increments the step index', () => {
    const g = useCompanionStore.getState();
    g.startGuidance('persona_creation');
    g.advanceGuidance();
    g.advanceGuidance();
    expect(useCompanionStore.getState().guidanceStepIndex).toBe(2);
  });

  it('pause/resume toggles guidancePlaying without ending the walkthrough', () => {
    const g = useCompanionStore.getState();
    g.startGuidance('persona_creation');
    g.pauseGuidance();
    expect(useCompanionStore.getState().guidancePlaying).toBe(false);
    expect(useCompanionStore.getState().activeWalkthrough).toBe('persona_creation');
    g.resumeGuidance();
    expect(useCompanionStore.getState().guidancePlaying).toBe(true);
  });

  it('stopGuidance clears all guidance state', () => {
    const g = useCompanionStore.getState();
    g.startGuidance('persona_creation');
    g.setGuidanceHighlightTestId('persona-intent-input');
    g.setOrbGuideTarget({ left: 100, top: 200 });
    g.advanceGuidance();
    g.stopGuidance();
    const s = useCompanionStore.getState();
    expect(s.activeWalkthrough).toBeNull();
    expect(s.guidanceStepIndex).toBe(0);
    expect(s.guidancePlaying).toBe(false);
    expect(s.guidanceHighlightTestId).toBeNull();
    expect(s.orbGuideTarget).toBeNull();
  });
});
