import { useCallback, useState } from 'react';
import { Bot } from 'lucide-react';
import { toastCatch } from '@/lib/silentCatch';
import { webbuildSessionSend } from '@/api/webbuild';
import { BUBBLE_COPY, MOCK_PHASES, type BubbleViewProps, type Msg } from './studioBuildModel';
import StudioBubbleBaseline from './StudioBubbleBaseline';
import StudioBubbleThread from './StudioBubbleThread';
import StudioBubbleCockpit from './StudioBubbleCockpit';

// Host for the Studio comms-bubble PROTOTYPE: owns the real chat state + the
// build-session send, and A/Bs the directional variants behind a small switcher
// (throwaway — collapses to the winner at consolidation). The variants are pure
// presentation receiving identical props (studioBuildModel.BubbleViewProps).

type Variant = 'thread' | 'cockpit' | 'baseline';
const VARIANTS: { id: Variant; label: string }[] = [
  { id: 'thread', label: 'Thread' },
  { id: 'cockpit', label: 'Cockpit' },
  { id: 'baseline', label: 'Chat' },
];

export default function StudioBubble({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const [open, setOpen] = useState(true);
  const [variant, setVariant] = useState<Variant>('thread');
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);

  const onSend = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    setMessages((m) => [...m, { role: 'you', text }]);
    setBusy(true);
    try {
      const reply = await webbuildSessionSend(projectId, text);
      setMessages((m) => [...m, { role: 'athena', text: reply.trim() || 'Done.' }]);
    } catch (e) {
      setMessages((m) => [...m, { role: 'athena', text: 'Something went wrong with that change.' }]);
      toastCatch('build instruction')(e);
    } finally {
      setBusy(false);
    }
  }, [input, busy, projectId]);

  // Stub for the orb-fly-to-comment behaviour — visualised as an Athena note for
  // now; wired to the real orb glide + preview-bridge in a later increment.
  const onPointAt = useCallback((label: string) => {
    setMessages((m) => [...m, { role: 'athena', text: `Looking at the ${label}…` }]);
  }, []);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={BUBBLE_COPY.title}
        className="absolute bottom-4 right-4 flex h-12 w-12 items-center justify-center rounded-full border border-primary/30 bg-primary/15 text-primary shadow-elevation-3 backdrop-blur transition-colors hover:bg-primary/25"
      >
        <Bot className="h-6 w-6" />
      </button>
    );
  }

  const viewProps: BubbleViewProps = {
    projectName,
    messages,
    phases: MOCK_PHASES,
    input,
    setInput,
    busy,
    onSend,
    onClose: () => setOpen(false),
    onPointAt,
  };

  return (
    <div className="absolute bottom-4 right-4 flex w-[22rem] max-w-[calc(100%-2rem)] flex-col">
      {/* Prototype variant switcher (throwaway). */}
      <div className="mb-2 flex items-center gap-1 self-end rounded-full border border-border bg-background/90 p-0.5 shadow-elevation-2 backdrop-blur">
        {VARIANTS.map((v) => (
          <button
            key={v.id}
            type="button"
            onClick={() => setVariant(v.id)}
            className={`rounded-full px-2.5 py-0.5 text-xs transition-colors ${variant === v.id ? 'bg-primary/20 text-primary' : 'text-foreground/60 hover:text-foreground'}`}
          >
            {v.label}
          </button>
        ))}
      </div>
      {variant === 'thread' && <StudioBubbleThread {...viewProps} />}
      {variant === 'cockpit' && <StudioBubbleCockpit {...viewProps} />}
      {variant === 'baseline' && <StudioBubbleBaseline {...viewProps} />}
    </div>
  );
}
