import { describe, it, expect } from 'vitest';
import { buildPrintDocument } from '../reportPrint';
import { priorityConfig, reportFormat } from '../reportHelpers';
import type { PersonaReport } from '@/lib/types/types';

const LABELS = { unknownPersona: 'Unknown', reportLabel: 'Report' };

function report(over: Partial<PersonaReport>): PersonaReport {
  return {
    id: 'r1',
    persona_id: 'p1',
    execution_id: null,
    title: 'Weekly',
    content: '',
    content_type: 'markdown',
    priority: 'normal',
    is_read: false,
    metadata: null,
    created_at: '2026-10-06T10:00:00Z',
    read_at: null,
    thread_id: null,
    persona_name: 'Scout',
    ...over,
  } as PersonaReport;
}

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

describe('buildPrintDocument', () => {
  it('prints RENDERED markdown - headings, tables, chart bars - never escaped source', async () => {
    const md = '## Findings\n\n| k | v |\n|---|---|\n| a | 1 |\n\n```chart\nAlpha: 3\nBeta: 6\n```\n\n**bold**';
    const html = await buildPrintDocument(report({ content: md }), LABELS);
    const doc = parse(html);
    expect(doc.querySelector('main h2')?.textContent).toBe('Findings');
    expect(doc.querySelector('main table td')?.textContent).toBe('a');
    expect(doc.querySelector('main strong')?.textContent).toBe('bold');
    // Chart bars carry their width, and the print sheet draws them.
    const bars = Array.from(doc.querySelectorAll('main .h-full')) as HTMLElement[];
    expect(bars.length).toBe(2);
    expect(bars[1]?.style.width).toBe('100%');
    expect(doc.querySelector('style')?.textContent).toContain('.h-6 > .h-full');
    // No raw markdown punctuation survived as text.
    expect(doc.body.textContent).not.toMatch(/\|---\||\*\*bold\*\*|```/);
  });

  it('prints an html report as its sanitized document', async () => {
    const html = await buildPrintDocument(
      report({ content_type: 'html', content: '<style>h1{color:navy}</style><h1>T</h1><script>alert(1)</script><img src="https://x/y.png">' }),
      LABELS,
    );
    expect(html).not.toMatch(/<script|https:\/\/x/);
    const doc = parse(html);
    expect(doc.querySelector('h1')?.textContent).toBe('T');
    expect(doc.title).toBe('Weekly');
    expect(Array.from(doc.querySelectorAll('style')).map((s) => s.textContent).join('')).toContain('h1{color:navy}');
  });
});

describe('report helpers', () => {
  it('maps content_type to a body format', () => {
    expect(reportFormat('html')).toBe('html');
    expect(reportFormat('markdown')).toBe('markdown');
    expect(reportFormat('alert')).toBe('markdown');
    expect(reportFormat(null)).toBe('markdown');
  });

  it('has a Critical tier (the engine writes `critical`)', () => {
    expect(priorityConfig.critical?.label).toBe('Critical');
  });
});
