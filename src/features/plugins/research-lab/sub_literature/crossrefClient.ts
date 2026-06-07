/**
 * Crossref REST-API metadata client. Runs in the browser (Tauri webview).
 * Docs: https://api.crossref.org/swagger-ui/index.html
 *
 * Crossref responds with `Access-Control-Allow-Origin: *`, so CORS is not an
 * issue — the same as the arXiv client this mirrors. This client covers DOI
 * and free-text bibliographic metadata lookup only; it returns the single best
 * match so a user can pre-fill the "add source" form.
 */

export interface CrossrefResult {
  title: string;
  authors: string;            // comma-separated "Given Family"
  abstract: string | null;    // JATS tags stripped
  year: number | null;
  doi: string | null;
  citationCount: number | null;
  url: string | null;
}

export interface LookupCrossrefOptions {
  /** A DOI (10.xxxx/…) or free-text bibliographic query (e.g. a paper title). */
  query: string;
  /** AbortSignal to cancel the request. */
  signal?: AbortSignal;
  /** Abort the request after this many ms. Default 15000. */
  timeoutMs?: number;
}

/** Why a Crossref lookup failed — lets the UI surface an actionable message. */
export type CrossrefErrorKind = 'timeout' | 'http' | 'network' | 'parse';

/**
 * A failed Crossref lookup. Distinct from "no match": a `null` result means
 * "nothing found for that DOI/title", a CrossrefLookupError means the request
 * itself failed (timed out, was rate-limited, returned malformed JSON, …).
 */
export class CrossrefLookupError extends Error {
  readonly kind: CrossrefErrorKind;
  /** HTTP status, when kind === 'http'. */
  readonly status?: number;
  constructor(kind: CrossrefErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'CrossrefLookupError';
    this.kind = kind;
    this.status = status;
  }
}

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Heuristic: does the query look like a DOI? Crossref DOIs always start with
 * "10." followed by a registrant code and a slash. We also accept a full DOI
 * URL (https://doi.org/10.…) and strip the scheme/host.
 */
function extractDoi(raw: string): string | null {
  const trimmed = raw.trim();
  const stripped = trimmed.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
  return /^10\.\d{4,9}\/\S+$/.test(stripped) ? stripped : null;
}

/**
 * Look up bibliographic metadata from Crossref. If `query` looks like a DOI we
 * resolve it directly via `/works/{doi}`; otherwise we run a bibliographic
 * search and take the single best match. Returns `null` when nothing matches.
 */
export async function lookupCrossref({
  query,
  signal,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: LookupCrossrefOptions): Promise<CrossrefResult | null> {
  const doi = extractDoi(query);
  const url = doi
    ? `https://api.crossref.org/works/${encodeURIComponent(doi)}`
    : `https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(query.trim())}&rows=1`;

  // Combine an internal timeout with the caller's optional cancel signal — the
  // same pattern arxivClient uses so a slow/throttled Crossref (it rate-limits
  // anonymous clients) can never leave the lookup spinner stuck.
  const timeoutCtrl = new AbortController();
  const timer = setTimeout(() => timeoutCtrl.abort(), timeoutMs);
  const onExternalAbort = () => timeoutCtrl.abort();
  if (signal) {
    if (signal.aborted) timeoutCtrl.abort();
    else signal.addEventListener('abort', onExternalAbort, { once: true });
  }

  try {
    const res = await fetch(url, {
      signal: timeoutCtrl.signal,
      headers: { Accept: 'application/json' },
    });
    // A DOI miss returns HTTP 404 — treat that as "no match", not a hard error.
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new CrossrefLookupError('http', `Crossref request failed: ${res.status} ${res.statusText}`, res.status);
    }
    const json = await res.json();
    return parseCrossref(json, Boolean(doi));
  } catch (err) {
    if (err instanceof CrossrefLookupError) throw err;
    if ((err as Error)?.name === 'AbortError') {
      // The caller cancelled (e.g. a newer lookup superseded this one) →
      // preserve the raw AbortError so callers can ignore it. Otherwise our own
      // timeout fired.
      if (signal?.aborted) throw err;
      throw new CrossrefLookupError('timeout', `Crossref lookup timed out after ${Math.round(timeoutMs / 1000)}s`);
    }
    throw new CrossrefLookupError('network', (err as Error)?.message || 'Failed to reach Crossref');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onExternalAbort);
  }
}

/**
 * Map a Crossref API envelope to our flat result shape. `byDoi` distinguishes
 * the `/works/{doi}` response (`message` is the work) from the search response
 * (`message.items[]` is a list).
 */
function parseCrossref(json: unknown, byDoi: boolean): CrossrefResult | null {
  if (!json || typeof json !== 'object') {
    throw new CrossrefLookupError('parse', 'Crossref returned a response that could not be parsed');
  }
  const message = (json as Record<string, unknown>).message;
  if (!message || typeof message !== 'object') {
    throw new CrossrefLookupError('parse', 'Crossref returned a response with no message');
  }

  const work = byDoi
    ? (message as Record<string, unknown>)
    : ((message as Record<string, unknown>).items as Record<string, unknown>[] | undefined)?.[0];

  if (!work) return null;

  return mapWork(work);
}

function mapWork(work: Record<string, unknown>): CrossrefResult {
  const title = firstString(work.title) ?? '';
  const authors = parseAuthors(work.author);
  const abstract = stripJats(typeof work.abstract === 'string' ? work.abstract : null);
  const year = parseYear(work);
  const doi = typeof work.DOI === 'string' ? work.DOI : null;
  const citationCount =
    typeof work['is-referenced-by-count'] === 'number'
      ? (work['is-referenced-by-count'] as number)
      : null;
  const url = typeof work.URL === 'string' ? work.URL : null;

  return { title, authors, abstract, year, doi, citationCount, url };
}

/** Crossref `title` / `abstract` fields are arrays of strings. */
function firstString(value: unknown): string | null {
  if (Array.isArray(value)) {
    const first = value.find((v) => typeof v === 'string' && v.trim());
    return typeof first === 'string' ? first.replace(/\s+/g, ' ').trim() : null;
  }
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : null;
}

/** Map Crossref `author[]` entries to a "Given Family, …" string. */
function parseAuthors(value: unknown): string {
  if (!Array.isArray(value)) return '';
  return value
    .map((a) => {
      if (!a || typeof a !== 'object') return '';
      const author = a as Record<string, unknown>;
      const given = typeof author.given === 'string' ? author.given.trim() : '';
      const family = typeof author.family === 'string' ? author.family.trim() : '';
      const name = [given, family].filter(Boolean).join(' ');
      // Some entries (organizations) carry only a `name` field.
      return name || (typeof author.name === 'string' ? author.name.trim() : '');
    })
    .filter(Boolean)
    .join(', ');
}

/**
 * Resolve a publication year from Crossref date fields. Prefer `published`,
 * fall back to `issued` / `created`. Each is `{ "date-parts": [[year, …]] }`.
 */
function parseYear(work: Record<string, unknown>): number | null {
  for (const key of ['published', 'published-print', 'published-online', 'issued', 'created']) {
    const node = work[key];
    if (node && typeof node === 'object') {
      const parts = (node as Record<string, unknown>)['date-parts'];
      if (Array.isArray(parts) && Array.isArray(parts[0])) {
        const y = (parts[0] as unknown[])[0];
        if (typeof y === 'number' && y > 0) return y;
      }
    }
  }
  return null;
}

/**
 * Crossref abstracts are JATS XML (e.g. `<jats:p>…</jats:p>`). Strip the tags
 * and collapse whitespace so the abstract drops cleanly into the form.
 */
function stripJats(abstract: string | null): string | null {
  if (!abstract) return null;
  const text = abstract
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
  return text || null;
}
