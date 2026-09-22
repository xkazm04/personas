/**
 * The Twin experience (contest entry `experience_opus`): creating a twin and
 * training it, as one full-screen layer over the app.
 *
 * The whole surface lives in this folder. Outside it there are exactly two
 * wiring points: `TwinPage` mounts `TwinExperienceHost` and routes the Setup
 * tab to `ExperienceSetupPage`; the Profiles roster calls
 * `openTwinExperience({ mode: 'create' })` where it used to open the create
 * dialog. Research, decisions and prompt changes: `RESEARCH.md`.
 */

export { TwinExperienceHost } from './TwinExperienceHost';
export { openTwinExperience, closeTwinExperience, type TwinExperienceRequest } from './launcher';
