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
}

export async function searchArxiv({ query, maxResults = 10, signal }: SearchArxivOptions): Promise<ArxivResult[]> {
  const params = new URLSearchParams({
    search_query: `all:${query}`,
    start: '0',
    max_results: String(Math.min(50, Math.max(1, maxResults))),
    sortBy: 'relevance',
    sortOrder: 'descending',
  });
  const url = `https://export.arxiv.org/api/query?${params.toString()}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`arXiv request failed: ${res.status} ${res.statusText}`);
  const text = await res.text();
  return parseAtomFeed(text);
}

function parseAtomFeed(xml: string): ArxivResult[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const errorNode = doc.querySelector('parsererror');
  if (errorNode) return [];

  const entries = Array.from(doc.getElementsByTagName('entry'));
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
