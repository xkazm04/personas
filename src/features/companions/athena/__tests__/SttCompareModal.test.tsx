import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SttCompareModal } from '../sub_voice/SttCompareModal';
import { useSystemStore } from '@/stores/systemStore';
import type { EngineTake, SttComparison } from '../useSttComparison';

// jsdom has neither SpeechRecognition nor getUserMedia, so the hook itself
// is not exercisable here; what this file pins is the presentation contract
// the modal builds on top of it.
const cmp = vi.hoisted(() => ({ value: null as unknown as SttComparison }));
vi.mock('../useSttComparison', () => ({
  useSttComparison: () => cmp.value,
}));

function take(over: Partial<EngineTake> = {}): EngineTake {
  return { supported: true, busy: false, text: '', interim: '', error: null, elapsedMs: null, ...over };
}

function comparison(over: Partial<SttComparison> = {}): SttComparison {
  return {
    recording: false,
    busy: false,
    hasResult: false,
    browser: take(),
    whisper: take(),
    start: vi.fn(),
    stop: vi.fn(),
    reset: vi.fn(),
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  cmp.value = comparison();
  useSystemStore.setState({ companionSttModelId: 'base.en' });
});

describe('SttCompareModal', () => {
  it('offers Record while idle and disables Clear with nothing to clear', () => {
    render(<SttCompareModal isOpen onClose={vi.fn()} />);
    expect(screen.getByTestId('stt-compare-record')).toBeInTheDocument();
    expect(screen.queryByTestId('stt-compare-stop')).not.toBeInTheDocument();
    expect(screen.getByTestId('stt-compare-reset')).toBeDisabled();
  });

  it('swaps Record for Stop while recording and drives the hook', () => {
    const stop = vi.fn();
    cmp.value = comparison({ recording: true, busy: true, stop });
    render(<SttCompareModal isOpen onClose={vi.fn()} />);
    expect(screen.queryByTestId('stt-compare-record')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('stt-compare-stop'));
    expect(stop).toHaveBeenCalled();
    // Clearing mid-take would strand the columns — blocked while recording.
    expect(screen.getByTestId('stt-compare-reset')).toBeDisabled();
  });

  it('shows both transcripts and their latencies side by side', () => {
    cmp.value = comparison({
      hasResult: true,
      browser: take({ text: 'browser heard this', elapsedMs: 120 }),
      whisper: take({ text: 'whisper heard this', elapsedMs: 1840 }),
    });
    render(<SttCompareModal isOpen onClose={vi.fn()} />);
    expect(screen.getByTestId('stt-compare-text-browser')).toHaveTextContent('browser heard this');
    expect(screen.getByTestId('stt-compare-text-whisper')).toHaveTextContent('whisper heard this');
    expect(screen.getByTestId('stt-compare-col-browser')).toHaveTextContent('120 ms');
    expect(screen.getByTestId('stt-compare-col-whisper')).toHaveTextContent('1840 ms');
    expect(screen.getByTestId('stt-compare-reset')).not.toBeDisabled();
  });

  it('renders the live interim transcript before a final one lands', () => {
    cmp.value = comparison({
      busy: true,
      browser: take({ busy: true, interim: 'partial words' }),
      whisper: take({ busy: true }),
    });
    render(<SttCompareModal isOpen onClose={vi.fn()} />);
    expect(screen.getByTestId('stt-compare-text-browser')).toHaveTextContent('partial words');
    // Whisper is batch: no interim, so its column stays empty while working.
    expect(screen.queryByTestId('stt-compare-text-whisper')).not.toBeInTheDocument();
  });

  it('fails one engine without taking the other down', () => {
    cmp.value = comparison({
      hasResult: true,
      browser: take({ error: 'not-allowed' }),
      whisper: take({ text: 'still transcribed' }),
    });
    render(<SttCompareModal isOpen onClose={vi.fn()} />);
    expect(screen.getByTestId('stt-compare-col-browser')).toHaveTextContent('not-allowed');
    expect(screen.getByTestId('stt-compare-text-whisper')).toHaveTextContent('still transcribed');
  });

  it('names the missing-model setup gap instead of a raw engine error', () => {
    useSystemStore.setState({ companionSttModelId: null });
    cmp.value = comparison({ whisper: take({ supported: false }) });
    render(<SttCompareModal isOpen onClose={vi.fn()} />);
    expect(screen.getByTestId('stt-compare-col-whisper')).toHaveTextContent(/Whisper model/i);
  });

  it('stops any live capture when closed', () => {
    const stop = vi.fn();
    const onClose = vi.fn();
    cmp.value = comparison({ recording: true, busy: true, stop });
    render(<SttCompareModal isOpen onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(stop).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});

// --------------------------------------------------------------------------
// sweep #258 — the bench has to end in a decision. Whisper producing a real
// transcript is what earns the offer to keep microphone audio on the machine.
// --------------------------------------------------------------------------

describe('SttCompareModal: adopt-after-compare', () => {
  beforeEach(() => {
    useSystemStore.setState({ companionSttEngine: 'browser', companionSttModelId: 'base.en' });
  });

  it('offers to switch to Whisper once it has transcribed the take', () => {
    cmp.value = comparison({
      hasResult: true,
      browser: take({ text: 'cloud heard this', elapsedMs: 120 }),
      whisper: take({ text: 'whisper heard this', elapsedMs: 1840 }),
    });
    render(<SttCompareModal isOpen onClose={vi.fn()} />);
    expect(screen.getByTestId('stt-compare-adopt')).toBeInTheDocument();
  });

  it('sets the engine to whisper and closes when the offer is taken', () => {
    const onClose = vi.fn();
    cmp.value = comparison({
      hasResult: true,
      whisper: take({ text: 'whisper heard this', elapsedMs: 1840 }),
    });
    render(<SttCompareModal isOpen onClose={onClose} />);
    fireEvent.click(screen.getByTestId('stt-compare-adopt'));
    expect(useSystemStore.getState().companionSttEngine).toBe('whisper');
    expect(onClose).toHaveBeenCalled();
  });

  it('leaves the engine alone when the operator just closes', () => {
    const onClose = vi.fn();
    cmp.value = comparison({
      hasResult: true,
      whisper: take({ text: 'whisper heard this' }),
    });
    render(<SttCompareModal isOpen onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(useSystemStore.getState().companionSttEngine).toBe('browser');
    expect(onClose).toHaveBeenCalled();
  });

  it('never offers what the local engine has not already delivered', () => {
    // Whisper failed or produced nothing: no offer, no promise.
    cmp.value = comparison({
      hasResult: true,
      browser: take({ text: 'cloud heard this' }),
      whisper: take({ error: 'sidecar missing' }),
    });
    render(<SttCompareModal isOpen onClose={vi.fn()} />);
    expect(screen.queryByTestId('stt-compare-adopt')).not.toBeInTheDocument();
  });

  it('does not offer a switch the panel is already on', () => {
    useSystemStore.setState({ companionSttEngine: 'whisper' });
    cmp.value = comparison({ hasResult: true, whisper: take({ text: 'whisper heard this' }) });
    render(<SttCompareModal isOpen onClose={vi.fn()} />);
    expect(screen.queryByTestId('stt-compare-adopt')).not.toBeInTheDocument();
  });
});
