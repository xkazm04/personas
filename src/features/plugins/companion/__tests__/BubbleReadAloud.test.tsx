import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const synthesize = vi.fn();
const play = vi.fn();

vi.mock('../voicePlayback', () => ({
  synthesize: (...args: unknown[]) => synthesize(...args),
  play: (...args: unknown[]) => play(...args),
}));

import { BubbleReadAloud } from '../BubbleReadAloud';

beforeEach(() => {
  synthesize.mockReset();
  play.mockReset();
});

function elevenLabsProps(over: Partial<Record<string, unknown>> = {}) {
  return {
    content: 'Hello from Athena.',
    voiceEngine: 'elevenlabs' as const,
    voiceCredentialId: 'cred_aaa',
    voiceId: 'voice_bbb',
    piperVoiceId: null,
    voiceSettings: undefined,
    ...over,
  };
}

describe('BubbleReadAloud', () => {
  it('renders nothing when no engine is configured (elevenlabs missing cred)', () => {
    render(
      <BubbleReadAloud
        content="hi"
        voiceEngine="elevenlabs"
        voiceCredentialId={null}
        voiceId={null}
        piperVoiceId={null}
        voiceSettings={undefined}
      />,
    );
    expect(screen.queryByTestId('companion-read-aloud')).toBeNull();
  });

  it('renders nothing when no engine is configured (piper missing voice)', () => {
    render(
      <BubbleReadAloud
        content="hi"
        voiceEngine="piper"
        voiceCredentialId={null}
        voiceId={null}
        piperVoiceId={null}
        voiceSettings={undefined}
      />,
    );
    expect(screen.queryByTestId('companion-read-aloud')).toBeNull();
  });

  it('renders nothing for whitespace-only content', () => {
    render(<BubbleReadAloud {...elevenLabsProps({ content: '   ' })} />);
    expect(screen.queryByTestId('companion-read-aloud')).toBeNull();
  });

  it('shows the Read aloud button when configured', () => {
    render(<BubbleReadAloud {...elevenLabsProps()} />);
    expect(screen.getByTestId('companion-read-aloud')).toBeInTheDocument();
  });

  it('synthesizes then plays on click, ending back at idle', async () => {
    const audio: Partial<HTMLAudioElement> & {
      _resolveDone?: () => void;
    } = {};
    synthesize.mockResolvedValueOnce('blob:url-1');
    play.mockImplementationOnce(() => {
      const done = new Promise<void>((res) => {
        audio._resolveDone = res;
      });
      return { audio, done };
    });

    render(<BubbleReadAloud {...elevenLabsProps()} />);
    fireEvent.click(screen.getByTestId('companion-read-aloud'));

    // synthesizing state appears briefly.
    await waitFor(() => {
      expect(
        screen.queryByTestId('companion-read-aloud-synthesizing'),
      ).toBeInTheDocument();
    });

    // synthesize completes → playing state.
    await waitFor(() => {
      expect(
        screen.getByTestId('companion-read-aloud-playing'),
      ).toBeInTheDocument();
    });

    expect(synthesize).toHaveBeenCalledWith(
      'Hello from Athena.',
      'cred_aaa',
      'voice_bbb',
      undefined,
      'elevenlabs',
    );

    // Playback ends → back to idle.
    audio._resolveDone?.();
    await waitFor(() => {
      expect(screen.getByTestId('companion-read-aloud')).toBeInTheDocument();
    });
  });

  it('Stop click during playback returns to idle without erroring', async () => {
    const audio = { pause: vi.fn() } as unknown as HTMLAudioElement;
    let rejectDone: ((reason: unknown) => void) | null = null;
    synthesize.mockResolvedValueOnce('blob:url-2');
    play.mockImplementationOnce(() => {
      const done = new Promise<void>((_, rej) => {
        rejectDone = rej;
      });
      return { audio, done };
    });

    render(<BubbleReadAloud {...elevenLabsProps()} />);
    fireEvent.click(screen.getByTestId('companion-read-aloud'));
    await waitFor(() => {
      expect(
        screen.getByTestId('companion-read-aloud-playing'),
      ).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('companion-read-aloud-playing'));
    // The handler pauses the audio and synchronously sets state back to idle.
    expect(audio.pause).toHaveBeenCalled();
    rejectDone?.(new Error('pause'));
    await waitFor(() => {
      expect(screen.getByTestId('companion-read-aloud')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('companion-read-aloud-error')).toBeNull();
  });

  it('surfaces an error chip when synthesis rejects', async () => {
    synthesize.mockRejectedValueOnce(new Error('voice quota exhausted'));
    render(<BubbleReadAloud {...elevenLabsProps()} />);
    fireEvent.click(screen.getByTestId('companion-read-aloud'));
    await waitFor(() => {
      expect(
        screen.getByTestId('companion-read-aloud-error'),
      ).toBeInTheDocument();
    });
  });

  it('routes piper engine to piperVoiceId, not voiceId', async () => {
    const audio = {} as HTMLAudioElement;
    synthesize.mockResolvedValueOnce('blob:url-3');
    play.mockImplementationOnce(() => ({
      audio,
      done: new Promise<void>((res) => res()),
    }));
    render(
      <BubbleReadAloud
        content="piper test"
        voiceEngine="piper"
        voiceCredentialId={null}
        voiceId={null}
        piperVoiceId="piper_en_us"
        voiceSettings={undefined}
      />,
    );
    fireEvent.click(screen.getByTestId('companion-read-aloud'));
    await waitFor(() => {
      expect(synthesize).toHaveBeenCalledWith(
        'piper test',
        null,
        'piper_en_us',
        undefined,
        'piper',
      );
    });
  });
});
