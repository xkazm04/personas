/**
 * The Twin experience: creating a twin and training it, as one overlay over
 * the app.
 *
 * The whole surface lives in this folder. Outside it there are exactly two
 * wiring points: `TwinPage` mounts `TwinExperienceHost` and routes the Setup
 * tab to `ExperienceSetupPage`, and the Profiles roster's "New twin" calls
 * `openTwinExperience({ mode: 'create' })`.
 *
 * It is the settled form of a four-way contest (2026-09-21/24): the framed
 * table, the question card and the fan come from the "Deck" entry, the felt it
 * is played on from "Table" at half its original visibility, and the side
 * layers — what the twin knows, what to train on, the voice studio, every
 * field — from "Mirror". `FUSION.md` records what came from where and why.
 */

export { TwinExperienceHost } from './TwinExperienceHost';
export { openTwinExperience, closeTwinExperience, type ExperienceRequest } from './launcher';
