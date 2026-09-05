import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { StatusIndicator } from '../PipelineDots';

describe('StatusIndicator', () => {
  it('renders a visible glyph in every state, including while executing', () => {
    // While a run is in flight the indicator used to be feedback/LoadingSpinner,
    // which renders null - the mini player header showed no status at all.
    const executing = render(<StatusIndicator isExecuting hasError={false} />);
    expect(executing.container.firstElementChild).not.toBeNull();

    const failed = render(<StatusIndicator isExecuting={false} hasError />);
    expect(failed.container.firstElementChild).not.toBeNull();

    const done = render(<StatusIndicator isExecuting={false} hasError={false} />);
    expect(done.container.firstElementChild).not.toBeNull();
  });
});
