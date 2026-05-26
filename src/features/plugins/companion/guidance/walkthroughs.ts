import type { GuidanceWalkthrough } from './types';

/**
 * Registry of Athena's guided walkthroughs, keyed by topic.
 *
 * Steps are authored HERE (not by the model) so the testids, narration, and
 * sequencing are reliable, i18n'd, and testable. Athena only *triggers* a topic
 * (`start_guided_walkthrough { topic }`); the runner walks these steps,
 * gliding the orb and ringing each anchor.
 *
 * To add a walkthrough for another part of the app:
 *   1. Add stable `data-testid`s to the elements you want to point at.
 *   2. Add a `plugins.companion.guide_<topic>_*` narration key per step to
 *      `src/i18n/locales/en.json` and regenerate i18n.
 *   3. Add an entry below and list its topic in `GUIDANCE_TOPICS`.
 *   4. Allow-list the topic in the backend (`dispatcher.rs` GUIDED_TOPICS) so
 *      Athena may trigger it.
 * See docs/features/companion/athena-guided-walkthroughs.md.
 */
export const WALKTHROUGHS: Record<string, GuidanceWalkthrough> = {
  persona_creation: {
    topic: 'persona_creation',
    title: (t) => t.plugins.companion.guide_pc_title,
    steps: [
      {
        id: 'intro',
        narration: (t) => t.plugins.companion.guide_pc_intro,
        orbAnchor: 'center',
      },
      {
        id: 'open',
        narration: (t) => t.plugins.companion.guide_pc_open,
        navigateRoute: 'personas',
        preAction: 'open_build_entry',
        highlightTestId: 'persona-build-entry',
        orbAnchor: 'auto',
      },
      {
        id: 'compose',
        narration: (t) => t.plugins.companion.guide_pc_compose,
        // The sigil's click-to-summon center — where the user describes the persona.
        highlightTestId: 'glyph-compose-summon',
        orbAnchor: 'auto',
      },
      {
        id: 'autonomous',
        narration: (t) => t.plugins.companion.guide_pc_autonomous,
        // The "let AI decide everything" one-shot toggle.
        highlightTestId: 'build-oneshot-toggle',
        orbAnchor: 'auto',
      },
      {
        id: 'outro',
        narration: (t) => t.plugins.companion.guide_pc_outro,
        orbAnchor: 'center',
      },
    ],
  },
};

/** Topics Athena is allowed to trigger. Mirrored by the backend allow-list. */
export const GUIDANCE_TOPICS = Object.keys(WALKTHROUGHS);

export function getWalkthrough(topic: string | null): GuidanceWalkthrough | null {
  if (!topic) return null;
  return WALKTHROUGHS[topic] ?? null;
}
