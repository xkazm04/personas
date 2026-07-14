/* ----------------------------------------------------------------------------
 * Channel event model — the pure vocabulary shared by every channel surface.
 *
 * These four helpers were born inside `sub_redRoom/useRedRoomFeed.ts` but are
 * imported by Collab and the monitor's channel views too. P2 deletes the Red
 * Room (it becomes a lens configuration over the shared stream), so they move
 * here first — a feature folder is the wrong owner for vocabulary three other
 * features depend on. See docs/plans/monitor-consolidation.md (D9).
 *
 * Pure functions only: no stores, no IPC, no React.
 * -------------------------------------------------------------------------- */

/** Parse either RFC3339 or SQLite naive-UTC ("YYYY-MM-DD HH:MM:SS") to epoch ms. */
export function toEpochUtc(s: string): number {
  if (!s) return 0;
  const hasTz = /[Zz]$/.test(s) || /[+-]\d{2}:?\d{2}$/.test(s);
  const iso = hasTz ? s : `${s.replace(' ', 'T')}Z`;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

/** The 8 event families. 'note' is the memory pseudo-family, assigned by item
 *  kind rather than derived from an event type. */
export type EventFamily = 'handoff' | 'pr' | 'qa' | 'release' | 'failure' | 'build' | 'note' | 'other';

/** Visual family for an event type — drives the stream's colour coding and the
 *  family lens. Derived from the raw `event_type` (which the read-model returns
 *  as an event row's `label`). */
export function eventFamily(eventType: string): Exclude<EventFamily, 'note'> {
  const e = eventType.toLowerCase();
  if (e.includes('fail') || e.includes('error')) return 'failure';
  if (e.startsWith('team_handoff')) return 'handoff';
  if (e.includes('.pr.') || e.endsWith('.pr')) return 'pr';
  if (e.startsWith('qa.')) return 'qa';
  if (e.startsWith('release.') || e.includes('published') || e.includes('version')) return 'release';
  if (e.includes('implementation') || e.includes('architecture') || e.includes('docs') || e.includes('scan')) return 'build';
  return 'other';
}

export interface ParsedPayload {
  summary: string | null;
  artifact: { url: string; label: string } | null;
}

/** Best-effort extraction of a human line + a link artifact from an event payload. */
export function parsePayload(payload: string | null): ParsedPayload {
  if (!payload) return { summary: null, artifact: null };
  try {
    const p: unknown = JSON.parse(payload);
    if (typeof p === 'string') return { summary: p.slice(0, 280), artifact: null };
    if (p && typeof p === 'object') {
      const o = p as Record<string, unknown>;
      const summary =
        firstString(o, ['summary', 'message', 'title', 'description', 'reason', 'task', 'goal']) ??
        null;
      const url = firstString(o, ['pr_url', 'prUrl', 'html_url', 'url', 'link', 'run_url']);
      const branch = firstString(o, ['branch', 'head', 'ref']);
      const artifact = url
        ? { url, label: url.includes('/pull/') ? `PR ${url.split('/pull/')[1] ?? ''}`.trim() : branch ?? shortUrl(url) }
        : null;
      return { summary: summary ? summary.slice(0, 280) : null, artifact };
    }
  } catch {
    // not JSON — treat the raw payload as the summary line, UNLESS it looks
    // like an opaque token (a long unbroken base64/hex/uuid-ish blob with no
    // whitespace). Those are ciphertext or ids that leaked into the payload,
    // not human messages — suppress rather than render a "hashed" line.
    if (looksOpaque(payload)) return { summary: null, artifact: null };
    return { summary: payload.slice(0, 280), artifact: null };
  }
  return { summary: null, artifact: null };
}

/** True for long whitespace-free base64/hex-ish blobs (ciphertext / ids). */
function looksOpaque(s: string): boolean {
  const t = s.trim();
  return t.length >= 40 && !/\s/.test(t) && /^[A-Za-z0-9+/=_\-.]+$/.test(t);
}

function firstString(o: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

function shortUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').slice(0, 40);
}

/* ----------------------------------------------------------------------------
 * Universal member colour — one colour per team member, everywhere.
 * Primary source is the persona's own `color` (the same hue the roster dots,
 * canvas nodes and editor use), so every channel surface agrees with the rest
 * of the app. Personas without a colour get a stable palette pick hashed from
 * their id, so the assignment never shifts between renders or sessions.
 * -------------------------------------------------------------------------- */

const MEMBER_FALLBACK_PALETTE = [
  '#a78bfa', '#60a5fa', '#fbbf24', '#34d399', '#f87171',
  '#38bdf8', '#fb923c', '#e879f9', '#4ade80', '#f472b6',
];

export function memberColor(persona: { color?: string | null } | undefined, personaId: string | null): string {
  if (persona?.color) return persona.color;
  if (!personaId) return '#9ca3af';
  let h = 0;
  for (let i = 0; i < personaId.length; i++) h = (h * 31 + personaId.charCodeAt(i)) >>> 0;
  return MEMBER_FALLBACK_PALETTE[h % MEMBER_FALLBACK_PALETTE.length]!;
}
