import { Hash, Mail, MessageSquare, MessagesSquare, Phone, Plus, Radio, Send, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import { getDeploymentChannelMeta, paletteOf } from '../shared/channels';
import type { ProfileChannelMark } from '../useProfileDashboards';

/**
 * The dominant element of a twin card: where this twin can speak, drawn as
 * marks rather than a list of names.
 *
 * Posture carries the state — a bound + active channel is lit and saturated,
 * a bound but paused channel is flat and drained, and a twin with no channels
 * at all gets ONE quiet invitation instead of an empty row. There is
 * deliberately no text label per mark; the mark plus its tooltip carries it,
 * because four labelled chips is the middle of the card spent on nothing.
 *
 * Lucide ships no brand glyphs, so each channel kind gets the closest generic
 * mark. Colour (from the shared channel palette) is what identifies the
 * channel; the glyph only has to be distinguishable from its neighbours.
 */
const CHANNEL_ICON: Record<string, LucideIcon> = {
  discord: MessagesSquare,
  slack: Hash,
  email: Mail,
  telegram: Send,
  sms: MessageSquare,
  teams: Users,
  whatsapp: Phone,
};

interface TwinChannelMarksProps {
  marks: ProfileChannelMark[];
  /** A mark is part of the card surface — pressing one also activates the twin. */
  onActivate: () => void;
  /** Only reachable from the empty affordance. */
  onAddChannel: () => void;
}

export function TwinChannelMarks({ marks, onActivate, onAddChannel }: TwinChannelMarksProps) {
  const t = useTranslation().t;

  if (marks.length === 0) {
    return (
      <div className="flex items-center gap-2 pointer-events-auto">
        <Tooltip content={t.twin.channels.noChannelsHint} placement="top">
          <button
            type="button"
            onClick={onAddChannel}
            aria-label={t.twin.channels.addChannel}
            className="w-11 h-11 rounded-card border border-dashed border-primary/15 text-muted flex items-center justify-center transition-colors hover:border-primary/30 hover:text-foreground hover:bg-secondary/30"
          >
            <Plus className="w-4 h-4" />
          </button>
        </Tooltip>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 flex-wrap pointer-events-auto">
      {marks.map((mark) => {
        const meta = getDeploymentChannelMeta(mark.type);
        const palette = paletteOf(meta);
        const Icon = CHANNEL_ICON[mark.type] ?? Radio;
        const stateLabel = mark.active ? t.common.active : t.twin.channels.paused;
        return (
          <Tooltip
            key={mark.type}
            placement="top"
            content={
              <span className="flex flex-col">
                <span>{meta.label}</span>
                <span className="opacity-60">{stateLabel}</span>
              </span>
            }
          >
            <button
              type="button"
              onClick={onActivate}
              aria-label={`${meta.label}, ${stateLabel}`}
              className={
                mark.active
                  ? `w-11 h-11 rounded-card flex items-center justify-center ${palette.bg} ring-1 ring-inset ring-primary/10 bg-gradient-to-br ${palette.tint} transition-transform hover:scale-105`
                  : 'w-11 h-11 rounded-card flex items-center justify-center bg-secondary/25 ring-1 ring-inset ring-primary/10 transition-transform hover:scale-105'
              }
            >
              <Icon className={mark.active ? `w-5 h-5 ${palette.text}` : 'w-5 h-5 text-muted-dark'} />
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}
