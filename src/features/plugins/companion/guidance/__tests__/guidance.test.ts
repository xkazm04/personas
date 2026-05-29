import { describe, it, expect, beforeEach } from 'vitest';
import {
  WALKTHROUGHS,
  GUIDANCE_TOPICS,
  getWalkthrough,
  resolveWalkthrough,
  ADHOC_TOPIC,
} from '../walkthroughs';
import { buildPointAtWalkthrough, buildComposedWalkthrough } from '../composeAdHoc';
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

  it('points the build steps at stable studio anchors', () => {
    const ids = WALKTHROUGHS.persona_creation!.steps
      .map((s) => s.highlightTestId)
      .filter(Boolean);
    expect(ids).toContain('persona-build-entry');
    expect(ids).toContain('glyph-compose-summon');
    expect(ids).toContain('build-oneshot-toggle');
  });

  it('lists persona_creation in GUIDANCE_TOPICS (backend allow-list mirror)', () => {
    expect(GUIDANCE_TOPICS).toContain('persona_creation');
  });

  it('getWalkthrough resolves known topics and rejects unknown/null', () => {
    expect(getWalkthrough('persona_creation')?.topic).toBe('persona_creation');
    expect(getWalkthrough('nope')).toBeNull();
    expect(getWalkthrough(null)).toBeNull();
  });

  it('registry walkthroughs carry an allow-listed completion CTA (v2)', () => {
    const pc = WALKTHROUGHS.persona_creation!.cta;
    expect(pc?.action).toBe('build_persona');
    expect(typeof pc?.label).toBe('function');
    const conn = WALKTHROUGHS.connector_setup!.cta;
    expect(conn?.action).toBe('open_connector_add');
  });
});

describe('resolveWalkthrough (registry vs ad-hoc)', () => {
  it('returns the ad-hoc walkthrough for the sentinel topic', () => {
    const adHoc = buildPointAtWalkthrough('nav_agents', 'Here.');
    expect(resolveWalkthrough(ADHOC_TOPIC, adHoc)?.topic).toBe(ADHOC_TOPIC);
  });
  it('returns the registry entry for a real topic, ignoring adHoc', () => {
    expect(resolveWalkthrough('persona_creation', null)?.topic).toBe('persona_creation');
  });
  it('returns null for no active topic', () => {
    expect(resolveWalkthrough(null, null)).toBeNull();
  });
});

describe('composeAdHoc builders (point_at / compose_walkthrough)', () => {
  it('buildPointAtWalkthrough makes a single step at the anchor testid', () => {
    const wt = buildPointAtWalkthrough('vault', 'Your vault.');
    expect(wt!.steps).toHaveLength(1);
    expect(wt!.steps[0]!.highlightTestId).toBe('credential-manager');
    expect(wt!.steps[0]!.navigateRoute).toBe('credentials');
  });

  it('attaches a "take me there" CTA for nav anchors (no route, has dest)', () => {
    const wt = buildPointAtWalkthrough('nav_connections', 'Connections live here.');
    expect(wt!.cta).toBeDefined();
    expect(typeof wt!.cta!.onSelect).toBe('function');
    // ad-hoc CTAs use onSelect, never the registry's closed-enum action.
    expect(wt!.cta!.action).toBeUndefined();
  });

  it('omits the CTA for content anchors (already navigated via route)', () => {
    expect(buildPointAtWalkthrough('vault', 'x')!.cta).toBeUndefined();
  });

  it('returns null for an unknown anchor (safety boundary)', () => {
    expect(buildPointAtWalkthrough('window.localStorage', 'x')).toBeNull();
  });

  it('buildComposedWalkthrough keeps valid steps and drops off-catalog ones', () => {
    const ok = buildComposedWalkthrough([
      { anchor: 'nav_agents', narration: 'Agents.' },
      { anchor: 'nav_connections', narration: 'Connections.' },
    ]);
    expect(ok!.steps).toHaveLength(2);

    const mixed = buildComposedWalkthrough([
      { anchor: 'nav_agents', narration: 'ok' },
      { anchor: 'bogus', narration: 'dropped' },
    ]);
    expect(mixed!.steps).toHaveLength(1);

    expect(buildComposedWalkthrough([])).toBeNull();
    expect(buildComposedWalkthrough([{ anchor: 'bogus', narration: 'x' }])).toBeNull();
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

  it('previousGuidance steps back, clamps at 0, and pauses (v2)', () => {
    const g = useCompanionStore.getState();
    g.startGuidance('persona_creation');
    g.advanceGuidance(); // -> 1
    g.previousGuidance(); // -> 0, paused
    const s = useCompanionStore.getState();
    expect(s.guidanceStepIndex).toBe(0);
    expect(s.guidancePlaying).toBe(false);
    g.previousGuidance(); // clamp at 0
    expect(useCompanionStore.getState().guidanceStepIndex).toBe(0);
  });

  it('jumpToStep sets an arbitrary step and pauses (v2)', () => {
    const g = useCompanionStore.getState();
    g.startGuidance('persona_creation');
    g.jumpToStep(3);
    const s = useCompanionStore.getState();
    expect(s.guidanceStepIndex).toBe(3);
    expect(s.guidancePlaying).toBe(false);
  });
});

describe('companionStore flashHighlight (v2 labeled pulse)', () => {
  beforeEach(() => {
    useCompanionStore.getState().stopGuidance();
  });

  it('sets the testid + optional label, skipped while a walkthrough runs', () => {
    const g = useCompanionStore.getState();
    g.flashHighlight('cockpit-panel', { label: 'Just composed' });
    let s = useCompanionStore.getState();
    expect(s.flashHighlightTestId).toBe('cockpit-panel');
    expect(s.flashHighlightLabel).toBe('Just composed');

    // Starting a walkthrough clears any pending flash...
    g.startGuidance('persona_creation');
    s = useCompanionStore.getState();
    expect(s.flashHighlightTestId).toBeNull();
    expect(s.flashHighlightLabel).toBeNull();

    // ...and flashes fired while a walkthrough is active are ignored.
    g.flashHighlight('overview-page');
    expect(useCompanionStore.getState().flashHighlightTestId).toBeNull();
  });
});
