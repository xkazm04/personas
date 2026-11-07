import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

import type { ScrapeRuleSet } from '@/api/scraper';
import { LlmRuleBuilder } from '../LlmRuleBuilder';

// The form hook outlives the editor modal, so a generation that resolves after
// the builder unmounted must not merge its fields into the next scrape.

const generate = vi.fn();
vi.mock('@/api/scraper', () => ({ generateScraperRules: (...a: unknown[]) => generate(...a) }));

const RULES = { title: { type: 'css', selector: 'h1', attr: null, all: false } } as unknown as ScrapeRuleSet;

describe('LlmRuleBuilder', () => {
  it('applies generated rules while mounted', async () => {
    generate.mockResolvedValueOnce(RULES);
    const onRules = vi.fn();
    render(<LlmRuleBuilder urls={['https://x']} hasFields={false} onRules={onRules} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'the title' } });
    await act(async () => { fireEvent.click(screen.getByRole('button')); });
    expect(onRules).toHaveBeenCalledWith(RULES, 'replace');
  });

  it('drops a generation that resolves after unmount', async () => {
    let resolve!: (r: ScrapeRuleSet) => void;
    generate.mockReturnValueOnce(new Promise<ScrapeRuleSet>((r) => { resolve = r; }));
    const onRules = vi.fn();
    const { unmount } = render(<LlmRuleBuilder urls={['https://x']} hasFields={false} onRules={onRules} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'the title' } });
    await act(async () => { fireEvent.click(screen.getByRole('button')); });
    unmount();
    await act(async () => { resolve(RULES); });
    expect(onRules).not.toHaveBeenCalled();
  });
});
