import { useShallow } from 'zustand/react/shallow';
import { Bot } from 'lucide-react';
import { useStudioStore } from './studioStore';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';

import Button from '@/features/shared/components/buttons/Button';

// B3 — global signal: when a Studio project is waiting on a decision and you are
// NOT currently on Studio, a floating pill surfaces it; clicking jumps to Studio
// and focuses the waiting project. The build keeps running in the background
// (studioStore is a persistent singleton), so this is purely a "you're needed"
// nudge — it never blocks the build. Mounted app-wide (DEV-only, like Studio).
export default function StudioAttention() {
  const { t, tx } = useTranslation();
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
  // The plural is selected here, at the call site, from the _one/_other pair —
  // the previous form baked an English "decisions" into the component. The
  // `studio` section is loaded by the Studio route; this pill only appears once
  // a Studio project is mid-build, so the section is already resolved by then.
  const label =
    sig.count > 1
      ? tx(t.studio.decisions_waiting_other, { count: sig.count })
      : tx(t.studio.athena_needs_you, { name: sig.name });

  return (
    <Button
      type="button"
      onClick={() => {
        setActive(targetId);
        setSidebarSection('studio');
      }}
      variant="secondary"
      size="sm"
      className="fixed bottom-6 right-6 z-[60]"
    >
      <span className="relative flex h-6 w-6 items-center justify-center">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/40" />
        <Bot className="relative h-4 w-4 text-primary" />
      </span>
      <span className="text-md text-foreground">{label}</span>
    </Button>
  );
}
