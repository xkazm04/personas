import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ResponseViewer } from '../ResponseViewer';

const response = (body: string, content_type: string) =>
  ({ status: 200, status_text: 'OK', duration_ms: 4, headers: {}, body, content_type, truncated: false }) as never;

describe('ResponseViewer body tab', () => {
  it('shows a non-JSON body as its own text and fetches nothing it names', () => {
    const body = 'see ![pixel](http://127.0.0.1:17320/probe) and *not italic*';
    const { container } = render(<ResponseViewer response={response(body, 'text/plain')} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('em')).toBeNull();
    expect(container.textContent).toContain(body);
  });

  it('still pretty-prints a JSON body', () => {
    const { container } = render(<ResponseViewer response={response('{"a":1}', 'application/json')} />);
    expect(container.textContent).toContain('"a": 1');
  });
});
