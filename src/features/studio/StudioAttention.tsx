import { useShallow } from 'zustand/react/shallow';
import { Bot } from 'lucide-react';
import { useStudioStore } from './studioStore';
import { useSystemStore } from '@/stores/systemStore';

// B3 — global signal: when a Studio project is waiting on a decision and you are
// NOT currently on Studio, a floating pill surfaces it; clicking jumps to Studio
// and focuses the waiting project. The build keeps running in the background
// (studioStore is a persistent singleton), so this is purely a "you're needed"
// nudge — it never blocks the build. Mounted app-wide (DEV-only, like Studio).
export default function StudioAttention() {
  const section = useSystemStore((s) => s.sidebarSection);
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);
  const setActive = useStudioStore((s) => s.setActive);
  const sig = useStudioStore(
    useShallow((s) => {
      const ids = s.tabOrder.filter((id) => s.runtimes[id]?.question);
      const first = ids[0];
      return {
        count: ids.length,
        id: first ?? null,
        name: first ? (s.runtimes[first]?.name ?? '') : '',
      };
    }),
  );

  if (section === 'studio' || sig.count === 0 || !sig.id) return null;
  const targetId = sig.id;
  const label = sig.count > 1 ? `${sig.count} decisions waiting` : `Athena needs you · ${sig.name}`;

  return (
    <button
      type="button"
      onClick={() => {
        setActive(targetId);
        setSidebarSection('studio');
      }}
      className="fixed bottom-6 right-6 z-[60] flex items-center gap-2 rounded-full border border-primary/40 bg-background/95 py-2 pl-3 pr-4 shadow-elevation-4 backdrop-blur transition-transform hover:scale-[1.03]"
    >
      <span className="relative flex h-6 w-6 items-center justify-center">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/40" />
        <Bot className="relative h-4 w-4 text-primary" />
      </span>
      <span className="text-md text-foreground">{label}</span>
    </button>
  );
}
