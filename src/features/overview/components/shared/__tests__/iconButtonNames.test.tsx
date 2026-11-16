/**
 * DW-180: the icon-only controls of the review flow and the memory dialogs are
 * nameable by assistive tech.
 *
 * The arrows that walk through reviews and decisions and the X on the memory
 * dialogs had no accessible name, so a screen-reader user heard only "button"
 * at the point of approving agent work. The help control removed its keyboard
 * focus ring.
 *
 * ReviewFocusFlow is asserted on its source, not mounted: it imports
 * ../libs/workspaceTint.css, deleted in 4068057590, so the module cannot be
 * resolved under test. (Its only importer, RailReviewModal, has no importer.)
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { en } from '@/i18n/en';
import { preloadSectionsAsync } from '@/i18n/useTranslation';
import { useOverviewStore } from '@/stores/overviewStore';
import MemoriesPageGraph from '@/features/overview/sub_memories/components/MemoriesPageGraph';
import ReviewResultsModal from '@/features/overview/sub_memories/components/ReviewResultsModal';
import { MetricHelpPopover } from '@/features/overview/components/dashboard/widgets/MetricHelpPopover';

beforeAll(async () => {
  await preloadSectionsAsync('en', ['overview']);
});

describe('ReviewFocusFlow (source)', () => {
  const source = readFileSync(
    resolve(process.cwd(), 'src/features/overview/sub_manual-review/components/ReviewFocusFlow.tsx'),
    'utf8',
  );
  /** Every opening tag of an icon-only Button in the file; a `>` inside braces does not end a tag. */
  const iconButtons = [...source.matchAll(/<Button\b/g)]
    .map((m) => {
      let depth = 0;
      for (let i = m.index; i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}') depth--;
        else if (source[i] === '>' && depth === 0) return source.slice(m.index, i + 1);
      }
      return '';
    })
    .filter((tag) => tag.includes('size="icon-sm"'));
  const tagWith = (handler: string) => iconButtons.find((tag) => tag.includes(handler)) ?? '';

  it('finds the four arrows', () => {
    expect(iconButtons).toHaveLength(4);
  });

  it('names the review arrows', () => {
    expect(en.templates.adopt_modal.previous).toBeTruthy();
    expect(en.templates.adopt_modal.next).toBeTruthy();
    expect(tagWith('goPrevReview')).toMatch(/aria-label=\{[^}]*templates\.adopt_modal\.previous/);
    expect(tagWith('goNextReview')).toMatch(/aria-label=\{[^}]*templates\.adopt_modal\.next/);
  });

  it('names the decision arrows', () => {
    expect(en.monitor.quick_prev_decision).toBeTruthy();
    expect(en.monitor.quick_next_decision).toBeTruthy();
    expect(tagWith('goPrevDecision')).toMatch(/aria-label=\{[^}]*monitor\.quick_prev_decision/);
    expect(tagWith('goNextDecision')).toMatch(/aria-label=\{[^}]*monitor\.quick_next_decision/);
  });
});

describe('MemoriesPageGraph memory dialog', () => {
  it('names its close button, and the button closes the dialog', async () => {
    const memory = {
      id: 'm1',
      persona_id: 'p1',
      title: 'Remembered thing',
      content: 'The body of the memory',
      category: 'fact',
      importance: 3,
      tier: 'active',
      access_count: 2,
      source_execution_id: null,
      tags: null,
      last_accessed_at: '2026-11-05T09:00:00Z',
      created_at: '2026-11-01T09:00:00Z',
      updated_at: '2026-11-05T09:00:00Z',
    };
    useOverviewStore.setState({
      memories: [memory],
      memoriesTotal: 1,
      memoriesLoading: false,
      memoriesError: null,
      fetchMemories: () => Promise.resolve(),
    } as never);

    render(<MemoriesPageGraph />);
    fireEvent.click(screen.getByRole('button', { name: memory.title }));

    fireEvent.click(screen.getByRole('button', { name: en.common.close }));
    await waitFor(() => expect(screen.queryByText(memory.content)).toBeNull());
  });
});

describe('ReviewResultsModal', () => {
  it('names its close button', () => {
    const onClose = vi.fn();
    render(<ReviewResultsModal reviewResult={null} reviewError="The review failed" onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: en.common.close }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('MetricHelpPopover', () => {
  it('keeps a keyboard focus ring on its button', () => {
    localStorage.removeItem('dashboard-help-dismissed');
    render(<MetricHelpPopover metricKey="messages" />);
    const classes = screen.getByRole('button', { name: /Messages/ }).className.split(/\s+/);
    expect(classes.some((c) => c.startsWith('focus-visible:ring'))).toBe(true);
    expect(classes).not.toContain('focus:outline-none');
  });
});
