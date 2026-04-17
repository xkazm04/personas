import { Bell, Plug } from 'lucide-react';
import { DesignCheckbox } from './DesignCheckbox';
import { channelIconMeta, SECTION_LABEL } from './helpers';
import { useTranslation } from '@/i18n/useTranslation';

interface MessagesSectionProps {
  channels: Array<{ type: string; description: string; required_connector: string; config_hints: Record<string, string> }>;
  selectedChannelIndices: Set<number>;
  onChannelToggle?: (index: number) => void;
  readOnly: boolean;
}

export function MessagesSection({
  channels,
  selectedChannelIndices,
  onChannelToggle,
  readOnly,
}: MessagesSectionProps) {
  const { t } = useTranslation();
  if (channels.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className={SECTION_LABEL}>
        <Bell className="w-4 h-4 text-blue-400" />
        {t.templates.design.messages_and_notifications}
        <span className="typo-body font-normal text-foreground ml-1">{t.templates.design.how_communicates}</span>
      </div>

      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(280px, 100%), 1fr))' }}>
        {channels.map((channel, chIdx) => {
          const isSelected = selectedChannelIndices.has(chIdx);
          return (
            <div key={`ch-${chIdx}`} className="bg-secondary/20 border border-primary/10 rounded-modal p-3.5">
              <div className="flex items-start gap-3">
                {!readOnly && (
                  <div className="mt-0.5">
                    <DesignCheckbox
                      checked={isSelected}
                      onChange={() => onChannelToggle?.(chIdx)}
                      color="blue"
                    />
                  </div>
                )}
                <div className="w-8 h-8 rounded-card bg-blue-500/10 border border-blue-500/20 flex items-center justify-center flex-shrink-0">
                  {(() => { const { Icon, color } = channelIconMeta(channel.type); return <Icon className={`w-4 h-4 ${color}`} />; })()}
                </div>
                <div className="flex-1 min-w-0">
                  <span className="typo-body font-medium text-foreground capitalize block">{channel.type}</span>
                  <span className="typo-body text-foreground leading-snug block mt-0.5">{channel.description}</span>
                  {channel.required_connector && (
                    <span className="inline-flex items-center gap-1 mt-2 px-2 py-0.5 typo-body rounded-full bg-primary/8 text-foreground border border-primary/10">
                      <Plug className="w-2.5 h-2.5" />
                      Requires {channel.required_connector}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
