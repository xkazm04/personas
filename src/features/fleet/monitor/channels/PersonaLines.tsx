import { memo } from 'react';
import { Bookmark, Radio, Sparkles } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { PersonaIcon } from '@/features/agents/components/PersonaIcon';
import type { Persona } from '@/lib/bindings/Persona';
import type { PersonaChannelItem } from '@/lib/bindings/PersonaChannelItem';
import { Lamp } from '../grid/prototype/entry-e/parts';
import { parseItemExtra } from './personaConversationModel';
import { MD_CHAT_RHYTHM } from './TalkLine';

/* ----------------------------------------------------------------------------
 * PERSONA LINES - a persona channel's talk, in the team thread's grammar
 * (WP12): the persona speaks beside its glyph tile, its name at heading weight
 * in its colour; Athena wears her glyph; the operator's lines sit right in the
 * primary tint (an echo still sending says so, a failed one says so in red).
 * Events and memories are one quiet caption line. All memo'd against the
 * channel slice's identity-preserving refresh.
 * -------------------------------------------------------------------------- */

export const PersonaChatBubble = memo(function PersonaChatBubble({ item, persona }: { item: PersonaChannelItem; persona: Persona }) {
  const { t } = useTranslation();
  const mine = item.authorKind === 'user';
  const extra = parseItemExtra(item);
  const athena = item.authorKind === 'athena';

  const bubble = (
    <div className={`min-w-0 max-w-[78%] rounded-card border px-3 py-2 ${
      mine ? (extra.failed === true ? 'border-status-error/35 bg-status-error/[0.07]' : 'border-primary/20 bg-primary/12') : 'border-border bg-secondary/30'
    }`}>
      {!mine && (
        <span className="mb-0.5 flex items-baseline gap-2">
          <span className={`typo-heading ${athena ? 'text-role-agent' : ''}`} style={athena ? undefined : { color: persona.color ?? undefined }}>
            {athena ? 'Athena' : persona.name.replace(/^T:\s*/, '')}
          </span>
          <span className="typo-caption"><RelativeTime timestamp={item.at} /></span>
        </span>
      )}
      <MarkdownRenderer content={item.body ?? ''} className={`typo-body text-foreground ${MD_CHAT_RHYTHM}`} />
      {extra.pending === true && <span className="mt-0.5 flex items-center gap-1.5 typo-caption"><Lamp lamp={{ tone: 'run', lit: true }} />{t.monitor.conv_persona_sending}</span>}
      {extra.failed === true && <span className="mt-0.5 block typo-caption text-status-error">{t.monitor.conv_persona_failed}</span>}
    </div>
  );
  if (mine) return <div className="flex justify-end py-1">{bubble}</div>;
  return (
    <div className="flex items-start gap-2.5 py-1">
      {athena ? (
        <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-card border border-border bg-secondary/40" aria-hidden>
          <Sparkles className="h-3.5 w-3.5 text-role-agent" />
        </span>
      ) : <PersonaIcon icon={persona.icon} color={persona.color} display="framed" frameSize="md" />}
      {bubble}
    </div>
  );
});

/** The persona owes a reply: a lit run lamp and the words, at the line's own weight. */
export const PersonaWorkingRow = memo(function PersonaWorkingRow({ personaName }: { personaName: string }) {
  const { t, tx } = useTranslation();
  return (
    <div className="flex items-center gap-2 py-1 pl-9">
      <Lamp lamp={{ tone: 'run', lit: true }} />
      <span className="typo-caption">{tx(t.monitor.conv_persona_working, { name: personaName })}</span>
    </div>
  );
});

export const PersonaSystemLine = memo(function PersonaSystemLine({ item }: { item: PersonaChannelItem }) {
  const { t, tx } = useTranslation();
  const memory = item.kind === 'memory';
  const Icon = memory ? Bookmark : Radio;
  const text = memory
    ? tx(t.monitor.conv_persona_memory_saved, { title: item.title ?? '' })
    : tx(t.monitor.conv_persona_event_emitted, { event: item.title ?? '' });
  return (
    <div className="flex items-center justify-center gap-1.5 py-0.5">
      <Icon className="h-3 w-3 flex-shrink-0 text-foreground" aria-hidden />
      <span className="truncate typo-caption">{text}</span>
      <span className="flex-shrink-0 typo-caption"><RelativeTime timestamp={item.at} /></span>
    </div>
  );
});
