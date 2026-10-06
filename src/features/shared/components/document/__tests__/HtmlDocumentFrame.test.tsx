import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { HtmlDocumentFrame } from '../HtmlDocumentFrame';
import { ReportBody } from '../ReportBody';

function frame(): HTMLIFrameElement {
  return screen.getByTitle('Doc') as HTMLIFrameElement;
}

describe('HtmlDocumentFrame', () => {
  it('builds a sanitized, script-free srcdoc in a sandbox without allow-scripts', async () => {
    render(
      <HtmlDocumentFrame
        title="Doc"
        html={'<style>h2{color:teal}</style><h2>T</h2><script>alert(1)</script><img src="x" onerror="alert(1)"><img src="https://evil.example/a.png">'}
      />,
    );
    await waitFor(() => expect(screen.getByTitle('Doc')).toBeTruthy());
    const el = frame();
    const sandbox = el.getAttribute('sandbox') ?? '';
    expect(sandbox).not.toContain('allow-scripts');
    expect(sandbox).toBe('allow-same-origin');
    const doc = el.getAttribute('srcdoc') ?? '';
    expect(doc).not.toMatch(/<script|onerror|evil\.example/i);
    expect(doc).toContain('h2{color:teal}');
    expect(doc).toContain('data-pa-theme');
  });

  it('resolves relative media through resolveMedia before building the document', async () => {
    const resolveMedia = vi.fn(async () => 'blob:app/42');
    render(<HtmlDocumentFrame title="Doc" html={'<img src="shots/a.png" alt="a">'} resolveMedia={resolveMedia} />);
    await waitFor(() => expect(screen.getByTitle('Doc')).toBeTruthy());
    expect(resolveMedia).toHaveBeenCalledWith('shots/a.png');
    expect(frame().getAttribute('srcdoc')).toContain('src="blob:app/42"');
  });

  it('holds a ghost (no spinner) until the document is ready', () => {
    render(<HtmlDocumentFrame title="Doc" html="<p>x</p>" />);
    expect(screen.getByTestId('html-document-ghost')).toBeTruthy();
  });
});

describe('ReportBody', () => {
  it('renders markdown with GFM tables and ```chart blocks', () => {
    const md = '## Results\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```chart\nAlpha: 3\nBeta: 6\n```\n';
    const { container } = render(<ReportBody title="R" document={{ format: 'markdown', content: md }} />);
    expect(container.querySelector('h2')?.textContent).toBe('Results');
    expect(container.querySelector('table td')?.textContent).toBe('1');
    // The chart block renders as bars, not as a code block.
    expect(container.textContent).toContain('Alpha');
    expect(container.querySelector('code.language-chart')).toBeNull();
  });

  it('routes html into the sandboxed frame', async () => {
    render(<ReportBody title="Doc" document={{ format: 'html', content: '<p>hello</p>' }} />);
    await waitFor(() => expect(screen.getByTitle('Doc')).toBeTruthy());
    expect(frame().getAttribute('srcdoc')).toContain('<p>hello</p>');
  });
});
