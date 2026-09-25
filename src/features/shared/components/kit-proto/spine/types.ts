/**
 * Spine & Lens: the closed vocabulary every composition shares (API.md of the A/3 contest entry).
 * Tone maps 1:1 to --primary, --status-*, --role-*; Glyph is how a tone is drawn; a Mark, a Dot
 * and a unit square for one state are the same glyph everywhere.
 */
export type Tone =
  | 'primary' | 'success' | 'warning' | 'error' | 'info' | 'neutral' | 'pending'
  | 'agent' | 'human' | 'external' | 'highlight';

/** `live` = primary with a slow breathing glow. */
export type Glyph = 'solid' | 'soft' | 'hollow' | 'empty' | 'live';

export type KitState = 'default' | 'hover' | 'selected' | 'muted' | 'live' | 'empty' | 'loading';

/** One state or several (a row can be selected AND live). */
export type KitStates = KitState | readonly KitState[];

function list(states: KitStates | undefined): KitState[] {
  if (!states) return [];
  return (typeof states === 'string' ? [states] : [...states]).filter((s) => s !== 'default');
}

/** `is-<state>` classes, the only way a composition changes with state. */
export function stateClass(states?: KitStates): string {
  return list(states).map((s) => `is-${s}`).join(' ');
}

/**
 * The attribute contract the variant's Lens reads: every composition root names itself and its
 * state, so a new composition is countable the moment it renders.
 */
export function kitAttrs(name: string, states?: KitStates): { 'data-kit': string; 'data-kit-state': string } {
  const l = list(states);
  return { 'data-kit': name, 'data-kit-state': l.length ? l.join(' ') : 'default' };
}

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
