/**
 * arXiv Atom-feed search client. Runs in the browser (Tauri webview).
 * Docs: https://info.arxiv.org/help/api/user-manual.html
 *
 * arXiv responds with `Access-Control-Allow-Origin: *`, so CORS is not an issue.
 * For deeper integration (PDF extraction, embedding), a Rust-side pipeline is required;
 * this client covers metadata fetch and listing only.
 */

export interface ArxivResult {
  id: string;            // arXiv id (e.g. 2401.12345)
  title: string;
  authors: string;       // comma-separated
  summary: string;
  published: string;     // ISO date
  year: number | null;
  url: string;           // abs url
  pdfUrl: string | null;
  doi: string | null;
}

export interface SearchArxivOptions {
  query: string;
  maxResults?: number;
  /** AbortSignal to cancel the request. */
  signal?: AbortSignal;
  /** Abort the request after this many ms. Default 15000. */
  timeoutMs?: number;
}

/** Why an arXiv search failed — lets the UI surface an actionable message. */
export type ArxivErrorKind = 'timeout' | 'http' | 'network' | 'feed' | 'parse';

/**
 * A failed arXiv search. Distinct from an empty result set: an empty array
 * means "no matches", an ArxivSearchError means the request itself failed
 * (timed out, was rate-limited, returned a malformed/error feed, …).
 */
export class ArxivSearchError extends Error {
  readonly kind: ArxivErrorKind;
  /** HTTP status, when kind === 'http'. */
  readonly status?: number;
  constructor(kind: ArxivErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'ArxivSearchError';
    this.kind = kind;
    this.status = status;
  }
}

const DEFAULT_TIMEOUT_MS = 15_000;

export async function searchArxiv({
  query,
  maxResults = 10,
  signal,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: SearchArxivOptions): Promise<ArxivResult[]> {
  const params = new URLSearchParams({
    search_query: `all:${query}`,
    start: '0',
    max_results: String(Math.min(50, Math.max(1, maxResults))),
    sortBy: 'relevance',
    sortOrder: 'descending',
  });
  const url = `https://export.arxiv.org/api/query?${params.toString()}`;

  // Combine an internal timeout with the caller's optional cancel signal.
  // The timeout covers the whole exchange (connect + body read) so a slow or
  // throttled arXiv (429s are common) can never leave the search spinner stuck.
  const timeoutCtrl = new AbortController();
  const timer = setTimeout(() => timeoutCtrl.abort(), timeoutMs);
  const onExternalAbort = () => timeoutCtrl.abort();
  if (signal) {
    if (signal.aborted) timeoutCtrl.abort();
    else signal.addEventListener('abort', onExternalAbort, { once: true });
  }

  try {
    const res = await fetch(url, { signal: timeoutCtrl.signal });
    if (!res.ok) {
      throw new ArxivSearchError('http', `arXiv request failed: ${res.status} ${res.statusText}`, res.status);
    }
    const text = await res.text();
    return parseAtomFeed(text);
  } catch (err) {
    if (err instanceof ArxivSearchError) throw err;
    if ((err as Error)?.name === 'AbortError') {
      // The caller cancelled (e.g. a newer search superseded this one) →
      // preserve the raw AbortError so callers can ignore it. Otherwise our
      // own timeout fired.
      if (signal?.aborted) throw err;
      throw new ArxivSearchError('timeout', `arXiv search timed out after ${Math.round(timeoutMs / 1000)}s`);
    }
    throw new ArxivSearchError('network', (err as Error)?.message || 'Failed to reach arXiv');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onExternalAbort);
  }
}

function parseAtomFeed(xml: string): ArxivResult[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const errorNode = doc.querySelector('parsererror');
  if (errorNode) {
    throw new ArxivSearchError('parse', 'arXiv returned a response that could not be parsed');
  }

  const entries = Array.from(doc.getElementsByTagName('entry'));

  // arXiv reports query errors with an HTTP-200 Atom feed containing a single
  // OpenSearch error entry (id points at /api/errors, title "Error"). Surface
  // it as a hard error instead of rendering it as a bogus "no results".
  if (entries.length === 1) {
    const only = entries[0]!;
    const entryId = text(only, 'id');
    if (/arxiv\.org\/api\/errors/i.test(entryId) || text(only, 'title').trim() === 'Error') {
      const detail = text(only, 'summary').replace(/\s+/g, ' ').trim();
      throw new ArxivSearchError('feed', detail || 'arXiv rejected the query');
    }
  }

  return entries.map((entry) => {
    const rawId = text(entry, 'id'); // e.g. http://arxiv.org/abs/2401.12345v1
    const arxivId = rawId.replace(/^https?:\/\/arxiv\.org\/abs\//, '').replace(/v\d+$/, '');
    const title = text(entry, 'title').replace(/\s+/g, ' ').trim();
    const summary = text(entry, 'summary').replace(/\s+/g, ' ').trim();
    const published = text(entry, 'published');
    const year = parseYear(published);
    const authors = Array.from(entry.getElementsByTagName('author'))
      .map((a) => text(a, 'name').trim())
      .filter(Boolean)
      .join(', ');
    const links = Array.from(entry.getElementsByTagName('link'));
    const pdfUrl = links.find((l) => l.getAttribute('title') === 'pdf')?.getAttribute('href') ?? null;
    const absUrl = links.find((l) => l.getAttribute('rel') === 'alternate')?.getAttribute('href') ?? rawId;
    const doi = Array.from(entry.getElementsByTagNameNS('http://arxiv.org/schemas/atom', 'doi'))[0]?.textContent ?? null;

    return {
      id: arxivId,
      title,
      authors,
      summary,
      published,
      year,
      url: absUrl,
      pdfUrl,
      doi,
    };
  });
}

function text(parent: Element, tag: string): string {
  const el = parent.getElementsByTagName(tag)[0];
  return el?.textContent ?? '';
}

function parseYear(iso: string): number | null {
  if (!iso) return null;
  const m = /^(\d{4})/.exec(iso);
  return m ? parseInt(m[1]!, 10) : null;
}
