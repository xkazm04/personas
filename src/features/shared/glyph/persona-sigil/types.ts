/**
 * Visual state for one petal on a Persona Sigil. Drives stroke width,
 * opacity, pulse animation, and color in `GlyphHeroSigil`.
 *
 *  - `idle`     — no data, no activity
 *  - `filling`  — LLM is currently resolving this dimension (build phase)
 *  - `resolved` — dimension has data
 *  - `pending`  — has an unanswered build-time question (build phase)
 *  - `error`    — most recent attempt failed
 */
export type PetalState = 'idle' | 'filling' | 'resolved' | 'pending' | 'error';
