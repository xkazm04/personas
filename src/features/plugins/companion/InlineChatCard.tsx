import { cockpitWidgetRegistry } from '@/features/home/components/cockpit/widgetRegistry';
import type { ChatCard } from '@/api/companion';

/**
 * One inline chat-card rendered inside the chat transcript. Wraps the
 * corresponding cockpit widget at a compact size so it fits the panel's
 * 380-760px width.
 *
 * Cards are emitted by `show_persona_overview` / `show_connected_services` /
 * `show_decisions` ops. Companion picks the moment — these aren't tied to
 * an approval card and don't ask the user to do anything; they're contextual
 * UI snippets that ride along with the chat reply.
 */
export function InlineChatCard({ card }: { card: ChatCard }) {
  const Component = cockpitWidgetRegistry[card.kind];
  if (!Component) {
    return (
      <div className="rounded-card border border-rose-500/30 bg-rose-500/[0.06] p-3 typo-caption text-rose-300">
        Unknown chat-card kind: {card.kind}
      </div>
    );
  }
  return (
    <div className="h-[260px]">
      <Component title={card.title} config={card.config} />
    </div>
  );
}
