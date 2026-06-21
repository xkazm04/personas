import { useStudioStore } from './studioStore';

// C3 — one-click build actions: common edits as buttons that fire a templated
// build instruction, so a non-technical user doesn't have to phrase the prompt.
// Athena may still ask a clarifying decision (A1) when an action is ambiguous.
const QUICK_ACTIONS: { label: string; prompt: string }[] = [
  {
    label: 'Add a page',
    prompt: 'Add a new page to the site and link it in the shared navigation.',
  },
  {
    label: 'Make responsive',
    prompt:
      'Review every page at mobile and tablet widths and fix layout, spacing, and overflow so it looks great on small screens.',
  },
  {
    label: 'Dark mode',
    prompt:
      'Add a polished dark mode with a header toggle that persists the choice, and make sure every page looks great in both themes.',
  },
  {
    label: 'Polish visuals',
    prompt:
      'Do a visual polish pass like a demanding design lead — typography, spacing rhythm, hierarchy, hover/focus states, and motion. Fix the weakest surfaces.',
  },
  {
    label: 'SEO & meta',
    prompt: 'Add metadata, Open Graph tags, a sitemap, and semantic HTML across the site.',
  },
];

export default function StudioQuickActions({ id }: { id: string }) {
  const sendTurn = useStudioStore((s) => s.sendTurn);
  return (
    <div className="pointer-events-auto flex flex-wrap gap-1.5 self-start">
      {QUICK_ACTIONS.map((a) => (
        <button
          key={a.label}
          type="button"
          onClick={() => void sendTurn(id, a.prompt)}
          className="rounded-full border border-border bg-background/80 px-2.5 py-1 text-xs text-foreground/70 shadow-elevation-1 backdrop-blur transition-colors hover:border-primary/40 hover:text-primary"
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}
