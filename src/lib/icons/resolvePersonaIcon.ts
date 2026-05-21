/**
 * Persona icon classifier — the single source of truth for what a persona's
 * `icon` string means.
 *
 * `persona.icon` is a free-form column that, historically, two renderers
 * (`PersonaIcon` and `PersonaAvatar`) interpreted slightly differently — most
 * visibly, `PersonaIcon` silently dropped HTTPS URLs while `PersonaAvatar`
 * honored them. Routing every renderer through `resolvePersonaIcon` collapses
 * that divergence and makes adding a new icon kind a one-file change.
 *
 * Recognised kinds:
 *   - `builtin`  — `agent-icon:{id}` from the curated catalog (theme-aware sprite)
 *   - `custom`   — `custom-icon:{assetId}` user-uploaded / generated image file
 *   - `url`      — an HTTPS image URL (already SSRF-sanitized here)
 *   - `emoji`    — a short non-ASCII glyph
 *   - `fallback` — empty, or an unrecognised string → renderer shows a default
 */

import { isAgentIcon } from './agentIconCatalog';
import { isCustomIcon, parseCustomIconId } from './customIconStore';
import { sanitizeIconUrl, isIconUrl } from '@/lib/utils/sanitizers/sanitizeUrl';

export type ResolvedIcon =
  /** `value` is the full `agent-icon:{id}` string — pass straight to the catalog resolvers. */
  | { kind: 'builtin'; value: string }
  /** `assetId` is the content hash — resolve a file URL via `useCustomIconSrc`. */
  | { kind: 'custom'; assetId: string }
  /** `url` is an already-sanitized HTTPS image URL, safe to use as an `<img src>`. */
  | { kind: 'url'; url: string }
  /** `char` is the emoji glyph to render as text. */
  | { kind: 'emoji'; char: string }
  /** Empty or unrecognised — the renderer supplies its own default (Bot / initial). */
  | { kind: 'fallback' };

/**
 * Detect emoji-like icons: short strings (≤8 chars) that aren't plain ASCII
 * identifiers. Anything longer or ASCII-only (a stale Lucide name like
 * "Database", a `persona:Foo` token) is not a valid icon. Shared by both
 * renderers so they agree.
 */
export function looksLikeEmoji(icon: string): boolean {
  const trimmed = icon.trim();
  return (
    trimmed.length > 0 &&
    trimmed.length <= 8 &&
    !/^[a-zA-Z0-9_:.\-/]+$/.test(trimmed)
  );
}

/**
 * Classify a persona icon value. Pure and synchronous — URL sanitization and
 * the emoji heuristic happen here so no renderer re-implements them.
 */
export function resolvePersonaIcon(icon: string | null | undefined): ResolvedIcon {
  if (typeof icon !== 'string' || icon.trim().length === 0) {
    return { kind: 'fallback' };
  }

  if (isAgentIcon(icon)) {
    return { kind: 'builtin', value: icon };
  }

  if (isCustomIcon(icon)) {
    const assetId = parseCustomIconId(icon);
    return assetId ? { kind: 'custom', assetId } : { kind: 'fallback' };
  }

  if (isIconUrl(icon)) {
    const safe = sanitizeIconUrl(icon);
    return safe ? { kind: 'url', url: safe } : { kind: 'fallback' };
  }

  if (looksLikeEmoji(icon)) {
    return { kind: 'emoji', char: icon.trim() };
  }

  return { kind: 'fallback' };
}
