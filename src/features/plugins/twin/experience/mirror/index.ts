/**
 * The Mirror (contest entry `experience_mirror`): creating a twin and training
 * it as ONE LIT LANE — a question, three answers, one field — with everything
 * heavier behind a door off it rather than in a column beside it.
 *
 * The whole surface lives in this folder. Outside it there are exactly two
 * wiring points, both in the contest scaffold: `twinExperienceVariant` mounts
 * `MirrorHost` and routes the Setup tab to `MirrorSetupPage`, and the Profiles
 * roster's "New twin" reaches `openMirror({ mode: 'create' })` through it.
 */

export { MirrorHost } from './MirrorHost';
export { openMirror, closeMirror, type MirrorRequest } from './launcher';
