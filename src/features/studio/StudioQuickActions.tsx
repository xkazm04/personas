import { useStudioStore } from './studioStore';

// C3 — one-click next steps. NOT hardcoded generic actions: these are derived
// from the project's live BUILD_PLAN — refine the active phase, build the next
// pending phases, or ask Athena to recommend + surface a direction decision. The
// prompts deliberately ask her to propose + confirm before building, so the user
// stays in control of direction (addresses the "decisions were non-existent"
// feedback at the chip level too).
export default function StudioQuickActions({ id }: { id: string }) {
  const sendTurn = useStudioStore((s) => s.sendTurn);
  const phases = useStudioStore((s) => s.runtimes[id]?.phases);

  const list = phases ?? [];
  const active = list.find((p) => p.status === 'active');
  const pending = list.filter((p) => p.status === 'pending').slice(0, 2);

  const chips: { label: string; prompt: string }[] = [];

  if (list.length === 0) {
    // Pre-plan: help the user get a plan + a starting decision on the table.
    chips.push(
      {
        label: 'Plan it out',
        prompt:
          'Lay out your build plan (emit BUILD_PLAN) and propose where to start — then ask me to confirm the direction before you build anything.',
      },
      {
        label: 'What should we build?',
        prompt:
          'Give me 2-3 concrete options for what to build first, with a recommendation, and ask me to pick.',
      },
    );
  } else {
    if (active) {
      chips.push({
        label: `Refine "${active.title}"`,
        prompt: `Refine the current phase ("${active.title}") — review it as a demanding design lead and fix the weakest spots (empty/loading/error states, edge cases, polish). Keep it honest.`,
      });
    }
    for (const p of pending) {
      chips.push({
        label: `Build "${p.title}"`,
        prompt: `Build the "${p.title}" phase next. Before writing any code, briefly propose your approach (2-3 sentences, and any real fork as options) and confirm the direction with me — then build it to a solid, honest state.`,
      });
    }
    chips.push({
      label: "What's next?",
      prompt:
        "What's the highest-value next step? Recommend one, lay out 2-3 concrete options, and ask me to pick before building — I want to steer direction.",
    });
  }

  return (
    <div className="pointer-events-auto flex flex-wrap gap-1.5 self-start">
      {chips.map((a) => (
        <button
          key={a.label}
          type="button"
          data-testid="studio-quick-action"
          onClick={() => void sendTurn(id, a.prompt)}
          className="rounded-full border border-border bg-background/80 px-2.5 py-1 text-xs text-foreground/70 shadow-elevation-1 backdrop-blur transition-colors hover:border-primary/40 hover:text-primary"
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}
