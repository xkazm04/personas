/**
 * Shared accent-tone tokens for Simple-mode variant chrome.
 *
 * The five-tone palette (Phase 11) is closed by design — see
 * `styles/simple-mode.css` for the CSS utilities each tone exposes
 * (`simple-accent-{tone}-{text|soft|border|solid}`).
 *
 * Five files used to declare this same union locally; consolidating here
 * prevents drift if a sixth tone is ever added (one edit, not six).
 */
export type Tone = 'amber' | 'violet' | 'emerald' | 'rose' | 'gold';
