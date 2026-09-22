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

function kokoroProps(over: Partial<Record<string, unknown>> = {}) {
  return {
    content: 'Hello from Athena.',
    voice: {
      engine: 'kokoro' as const,
      voiceId: 'af_heart',
      credentialId: null,
      configured: true,
    },
    voiceSettings: undefined,
    ...over,
  };
}

describe('BubbleReadAloud', () => {
  it('renders nothing when no engine is configured (kokoro missing voice)', () => {
    render(
      <BubbleReadAloud
        content="hi"
        voice={{ engine: 'kokoro', voiceId: null, credentialId: null, configured: false }}
        voiceSettings={undefined}
      />,
    );
    expect(screen.queryByTestId('companion-read-aloud')).toBeNull();
  });

  it('renders nothing when no engine is configured (pocket_tts missing voice)', () => {
    render(
      <BubbleReadAloud
        content="hi"
        voice={{ engine: 'pocket_tts', voiceId: null, credentialId: null, configured: false }}
        voiceSettings={undefined}
      />,
    );
    expect(screen.queryByTestId('companion-read-aloud')).toBeNull();
  });

  it('renders nothing for whitespace-only content', () => {
    render(<BubbleReadAloud {...kokoroProps({ content: '   ' })} />);
    expect(screen.queryByTestId('companion-read-aloud')).toBeNull();
  });

  it('shows the Read aloud button when configured', () => {
    render(<BubbleReadAloud {...kokoroProps()} />);
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

    render(<BubbleReadAloud {...kokoroProps()} />);
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
      null,
      'af_heart',
      undefined,
      'kokoro',
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

    render(<BubbleReadAloud {...kokoroProps()} />);
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
    render(<BubbleReadAloud {...kokoroProps()} />);
    fireEvent.click(screen.getByTestId('companion-read-aloud'));
    await waitFor(() => {
      expect(
        screen.getByTestId('companion-read-aloud-error'),
      ).toBeInTheDocument();
    });
  });

  it('routes pocket_tts engine to the pocket voice id', async () => {
    const audio = {} as HTMLAudioElement;
    synthesize.mockResolvedValueOnce('blob:url-3');
    play.mockImplementationOnce(() => ({
      audio,
      done: new Promise<void>((res) => res()),
    }));
    render(
      <BubbleReadAloud
        content="pocket test"
        voice={{ engine: 'pocket_tts', voiceId: 'step4', credentialId: null, configured: true }}
        voiceSettings={undefined}
      />,
    );
    fireEvent.click(screen.getByTestId('companion-read-aloud'));
    await waitFor(() => {
      expect(synthesize).toHaveBeenCalledWith(
        'pocket test',
        null,
        'step4',
        undefined,
        'pocket_tts',
      );
    });
  });

  it('routes kokoro engine to the kokoro voice id with a null credential', async () => {
    const audio = {} as HTMLAudioElement;
    synthesize.mockResolvedValueOnce('blob:url-4');
    play.mockImplementationOnce(() => ({
      audio,
      done: new Promise<void>((res) => res()),
    }));
    render(
      <BubbleReadAloud
        content="kokoro test"
        voice={{ engine: 'kokoro', voiceId: 'af_heart', credentialId: null, configured: true }}
        voiceSettings={undefined}
      />,
    );
    fireEvent.click(screen.getByTestId('companion-read-aloud'));
    await waitFor(() => {
      expect(synthesize).toHaveBeenCalledWith(
        'kokoro test',
        null,
        'af_heart',
        undefined,
        'kokoro',
      );
    });
  });
});
