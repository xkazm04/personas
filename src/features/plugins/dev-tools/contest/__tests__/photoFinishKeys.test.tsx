// The photo finish's keyboard (FE-10): Escape cancels the innermost thing (a
// pin being written), Ctrl+Enter saves it, and the arrows step the variants
// without stealing a caret.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { detailFixture } from './fixtures';

const api = vi.hoisted(() => ({ saveContestReview: vi.fn(async () => null) }));
vi.mock('@/api/contest', () => api);

import { FullScreenOverlay } from '@/features/shared/components/layout/FullScreenOverlay';
import type { ContestDetail } from '@/lib/bindings/ContestDetail';

import { PhotoFinish } from '../arena/PhotoFinish';
import { VariantFrame } from '../components/VariantFrame';
import { useReviewDraft } from '../hooks/useReviewDraft';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function openEditor() {
  fireEvent.click(screen.getByTestId('contest-frame-pin-layer-A/1'));
  return screen.getByTestId('contest-frame-pin-editor-A/1').querySelector('textarea')!;
}

describe('pin editor keys', () => {
  it('Escape cancels the pin and leaves the lightbox open', () => {
    const onClose = vi.fn();
    render(
      <FullScreenOverlay onClose={onClose}>
        <VariantFrame variant={detailFixture().variants[0]!} pins={[]} pinMode onAddPin={() => {}} />
      </FullScreenOverlay>,
    );
    const box = openEditor();
    fireEvent.change(box, { target: { value: 'note' } });
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(screen.queryByTestId('contest-frame-pin-editor-A/1')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Ctrl+Enter saves the pin', () => {
    const onAddPin = vi.fn();
    render(<VariantFrame variant={detailFixture().variants[0]!} pins={[]} pinMode onAddPin={onAddPin} />);
    const box = openEditor();
    fireEvent.change(box, { target: { value: 'tighten the hero' } });
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true });
    expect(onAddPin).toHaveBeenCalledTimes(1);
    expect(onAddPin.mock.calls[0]![0]).toMatchObject({ note: 'tighten the hero' });
  });
});

function Lightbox({ detail, onSelect }: { detail: ContestDetail; onSelect: (k: string) => void }) {
  const draft = useReviewDraft(detail);
  return <PhotoFinish detail={detail} draft={draft} currentKey="A/1" onSelect={onSelect} onClose={() => {}} />;
}

describe('lightbox arrows', () => {
  it('ArrowRight / ArrowLeft step the variants', async () => {
    const onSelect = vi.fn();
    render(<Lightbox detail={detailFixture()} onSelect={onSelect} />);
    await act(async () => {
      fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    });
    expect(onSelect).toHaveBeenLastCalledWith('B/1');
    await act(async () => {
      fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    });
    expect(onSelect).toHaveBeenLastCalledWith('B/1');
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it('an arrow typed in a text field moves the caret, not the lightbox', async () => {
    const onSelect = vi.fn();
    render(<Lightbox detail={detailFixture()} onSelect={onSelect} />);
    const field = screen.getAllByRole('textbox')[0]!;
    await act(async () => {
      fireEvent.keyDown(field, { key: 'ArrowRight' });
    });
    expect(onSelect).not.toHaveBeenCalled();
  });
});
