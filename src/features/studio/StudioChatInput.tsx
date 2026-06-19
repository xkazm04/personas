import { useCallback, useState } from 'react';
import { Send } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { toastCatch } from '@/lib/silentCatch';
import { webbuildSessionSend } from '@/api/webbuild';
import { useCompanionStore } from '@/features/plugins/companion/companionStore';

// Minimal Studio chat — JUST an input to send build instructions to Athena. Her
// reply is surfaced through the EXISTING orb notice bubble (reuse, not a new
// chat panel), so it lands in the familiar Athena experience beside the orb.
export default function StudioChatInput({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const setFooterNotice = useCompanionStore((s) => s.setFooterNotice);

  const showOrb = useCallback(
    (subject: string) => {
      setFooterNotice({
        id: `wb_${Date.now()}`,
        kind: 'proactive',
        subject,
        ttsSpoken: false,
        createdAt: Date.now(),
      });
    },
    [setFooterNotice],
  );

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    setBusy(true);
    try {
      const reply = await webbuildSessionSend(projectId, text);
      showOrb(reply.trim() || 'Done.');
    } catch (e) {
      showOrb('Something went wrong with that change.');
      toastCatch('build instruction')(e);
    } finally {
      setBusy(false);
    }
  }, [input, busy, projectId, showOrb]);

  return (
    <div className="pointer-events-auto absolute bottom-4 left-1/2 z-20 flex w-[min(36rem,calc(100%-7rem))] -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-background/90 py-1.5 pl-4 pr-1.5 shadow-elevation-3 backdrop-blur">
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void send();
          }
        }}
        placeholder={`Tell Athena what to build in ${projectName}…`}
        disabled={busy}
        className="min-w-0 flex-1 bg-transparent text-md text-foreground outline-none placeholder:text-foreground/45 disabled:opacity-60"
      />
      <Button
        variant="primary"
        size="sm"
        className="shrink-0 rounded-full"
        icon={<Send className="h-4 w-4" />}
        loading={busy}
        disabled={!input.trim() || busy}
        onClick={() => void send()}
      >
        Send
      </Button>
    </div>
  );
}
