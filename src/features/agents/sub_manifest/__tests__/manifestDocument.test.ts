/** manifestDocument — the Manifest tab's pure reading of `manifest.md`.
 *
 *  Two things are load-bearing enough to pin:
 *
 *  1. THE SECTION SPLIT. Which heading the operator may edit is decided by the
 *     server (`PersonaManifestView.lawSections` / `selfSections`), never by a
 *     list in this folder. If the parser ever classified by a hardcoded name,
 *     a heading the backend adds would silently become editable — or a law
 *     section would silently become read-only.
 *
 *  2. THE DIFF PREVIEW PARSE. `MemoryReviewProposal` carries no typed diff
 *     list; the target section survives onto the wire ONLY inside the
 *     `summary` string the server builds from `IdentityDiff::preview()`. That
 *     parse is what puts a pending change at the section it would edit, and a
 *     line it cannot read must still reach the operator rather than vanish.
 */
import { describe, it, expect } from 'vitest';
import { parseDiffPreviews, parseManifestSections, stripFrontmatter } from '../manifestDocument';

const LAW = ['Mandate', 'Boundaries', 'Operation defaults'];
const SELF = ['My work', 'My self-reads'];

const DOC = [
  '---',
  'type: manifest',
  'updated: 2026-09-04T08:00:00Z',
  '---',
  '',
  '# Mandate',
  '',
  'Docs bot — keeps the changelog honest.',
  '',
  '# Boundaries',
  '',
  '- no external sends',
  '',
  '# My work',
  '',
  '## What I own',
  '- the changelog (ep_1)',
  '',
].join('\n');

describe('stripFrontmatter', () => {
  it('removes the leading YAML block and nothing else', () => {
    expect(stripFrontmatter(DOC).startsWith('# Mandate')).toBe(true);
  });

  it('leaves a file with no frontmatter untouched', () => {
    expect(stripFrontmatter('# Mandate\n\nbody\n')).toBe('# Mandate\n\nbody\n');
  });

  it('does not eat a horizontal rule further down the document', () => {
    const md = '# Mandate\n\nbefore\n\n---\n\nafter\n';
    expect(stripFrontmatter(md)).toBe(md);
  });
});

describe('parseManifestSections', () => {
  it('splits on `# ` headings in FILE ORDER, not grouped by author', () => {
    const sections = parseManifestSections(DOC, LAW, SELF);
    expect(sections.map((s) => s.heading)).toEqual([
      'Mandate',
      'Boundaries',
      'My work',
    ]);
  });

  it('classifies by the SERVER-supplied split, not by a local name list', () => {
    const sections = parseManifestSections(DOC, LAW, SELF);
    expect(sections.map((s) => s.kind)).toEqual(['law', 'law', 'self']);

    // Same document, a server that calls `My work` law: the parser must follow
    // it. Anything else means a hardcoded list is deciding who may write.
    const flipped = parseManifestSections(DOC, ['My work'], ['Mandate']);
    expect(flipped.map((s) => s.kind)).toEqual(['self', 'other', 'law']);
  });

  it('keeps `## ` sub-headings inside their section body', () => {
    const work = parseManifestSections(DOC, LAW, SELF).find((s) => s.heading === 'My work')!;
    expect(work.body).toContain('## What I own');
    expect(work.body).toContain('- the changelog (ep_1)');
  });

  it('trims blank lines off a body but keeps its interior', () => {
    const mandate = parseManifestSections(DOC, LAW, SELF)[0]!;
    expect(mandate.body).toBe('Docs bot — keeps the changelog honest.');
  });

  it('carries text before the first heading rather than dropping it', () => {
    const sections = parseManifestSections('orphan preamble\n\n# Mandate\n\nbody\n', LAW, SELF);
    expect(sections[0]).toMatchObject({ heading: '', body: 'orphan preamble', kind: 'other' });
  });

  it('returns nothing for an empty document instead of a phantom section', () => {
    expect(parseManifestSections('', LAW, SELF)).toEqual([]);
  });
});

describe('parseDiffPreviews', () => {
  it('recovers the section path and its `# ` heading from a preview line', () => {
    const previews = parseDiffPreviews(
      '**My work / What I own** · add: “the release notes”\n' +
        '**My self-reads / Open questions** · remove: “none”',
    );
    expect(previews).toEqual([
      {
        section: 'My work / What I own',
        heading: 'My work',
        text: 'add: “the release notes”',
      },
      {
        section: 'My self-reads / Open questions',
        heading: 'My self-reads',
        text: 'remove: “none”',
      },
    ]);
  });

  it('handles a section path with no sub-heading', () => {
    expect(parseDiffPreviews('**My work** · add: “x”')[0]).toMatchObject({
      section: 'My work',
      heading: 'My work',
    });
  });

  it('keeps an unreadable line whole rather than dropping it', () => {
    // Nothing pending may ever become invisible: an unparsed line falls
    // through to the orphan block with an empty heading.
    const previews = parseDiffPreviews('something the server phrased differently');
    expect(previews).toEqual([
      { section: '', heading: '', text: 'something the server phrased differently' },
    ]);
  });

  it('returns nothing for a missing summary', () => {
    expect(parseDiffPreviews(null)).toEqual([]);
    expect(parseDiffPreviews(undefined)).toEqual([]);
    expect(parseDiffPreviews('')).toEqual([]);
  });
});
