import { useMemo } from 'react';
import { MessageSquare, Send, Mail, X, Bell } from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import { getConnectorMeta, ConnectorIcon } from '@/features/shared/components/display/ConnectorMeta';
import type { NotificationChannel, NotificationChannelType } from '@/lib/types/frontendTypes';

interface ChannelPickerProps {
  channels: NotificationChannel[];
  onToggle: (channel: NotificationChannel) => void;
}

/** Communication-related connector categories/names that qualify as notification channels */
const COMM_SERVICE_TYPES = new Set([
  'slack', 'telegram', 'email', 'discord', 'teams', 'microsoft-teams',
  'twilio', 'sendgrid', 'mailgun', 'whatsapp', 'sms',
]);

const fallbackIcons: Record<string, typeof MessageSquare> = {
  slack: MessageSquare,
  telegram: Send,
  email: Mail,
  'in-app': Bell,
};

interface ChannelOption {
  type: NotificationChannelType;
  label: string;
  credentialId?: string;
  credentialName?: string;
}

export function ChannelPicker({ channels, onToggle }: ChannelPickerProps) {
  const credentials = usePersonaStore((s) => s.credentials);
  const connectorDefinitions = usePersonaStore((s) => s.connectorDefinitions);

  // Build channel options from communication-type credentials + in-app default
  const channelOptions = useMemo<ChannelOption[]>(() => {
    const options: ChannelOption[] = [
      { type: 'in-app' as NotificationChannelType, label: 'In-app Messaging' },
    ];

    // Collect communication connectors that have saved credentials
    const commConnectors = connectorDefinitions.filter(
      (c) =>
        COMM_SERVICE_TYPES.has(c.name.toLowerCase()) ||
        c.category.toLowerCase() === 'communication' ||
        c.category.toLowerCase() === 'messaging',
    );

    const connectorNameSet = new Set(commConnectors.map((c) => c.name.toLowerCase()));

    // Add credentials whose service_type matches a communication connector
    for (const cred of credentials) {
      const st = cred.service_type.toLowerCase();
      if (COMM_SERVICE_TYPES.has(st) || connectorNameSet.has(st)) {
        options.push({
          type: st as NotificationChannelType,
          label: cred.name,
          credentialId: cred.id,
          credentialName: cred.name,
        });
      }
    }

    // If no credentials matched, still show the known communication connector types
    // so the user can add them without a saved credential
    const addedTypes = new Set(options.map((o) => o.type));
    for (const conn of commConnectors) {
      if (!addedTypes.has(conn.name.toLowerCase() as NotificationChannelType)) {
        const meta = getConnectorMeta(conn.name);
        options.push({
          type: conn.name.toLowerCase() as NotificationChannelType,
          label: meta.label,
        });
      }
    }

    return options;
  }, [credentials, connectorDefinitions]);

  const activeSet = useMemo(
    () => new Set(channels.map((c) => `${c.type}:${c.credential_id ?? ''}`)),
    [channels],
  );

  const handleToggle = (opt: ChannelOption) => {
    const key = `${opt.type}:${opt.credentialId ?? ''}`;
    if (activeSet.has(key)) {
      // Find and remove
      const existing = channels.find(
        (c) => c.type === opt.type && (c.credential_id ?? '') === (opt.credentialId ?? ''),
      );
      if (existing) onToggle(existing);
    } else {
      onToggle({
        type: opt.type,
        enabled: true,
        credential_id: opt.credentialId,
        config: {},
      });
    }
  };

  return (
    <div className="space-y-2">
      {/* Channel option chips */}
      <div className="flex flex-wrap gap-1.5">
        {channelOptions.map((opt) => {
          const key = `${opt.type}:${opt.credentialId ?? ''}`;
          const active = activeSet.has(key);
          const FallbackIcon = fallbackIcons[opt.type] ?? MessageSquare;
          const connMeta = getConnectorMeta(opt.type);
          const hasCustomIcon = connMeta.label !== opt.type; // getConnectorMeta returns name as label for unknown

          return (
            <button
              key={key}
              type="button"
              onClick={() => handleToggle(opt)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm font-medium rounded-xl border transition-all ${
                active
                  ? 'bg-primary/12 border-primary/30 text-primary ring-1 ring-primary/20'
                  : 'bg-secondary/30 border-primary/10 text-muted-foreground/70 hover:bg-secondary/50 hover:text-foreground/80'
              }`}
            >
              {hasCustomIcon ? (
                <ConnectorIcon meta={connMeta} size="w-3 h-3" />
              ) : (
                <FallbackIcon className="w-3 h-3" />
              )}
              {opt.label}
            </button>
          );
        })}
      </div>

      {/* Active channel config rows */}
      {channels.map((channel, index) => (
        <div
          key={`${channel.type}:${channel.credential_id ?? ''}:${index}`}
          className="flex items-center gap-2 p-2 bg-secondary/20 border border-primary/10 rounded-lg"
        >
          {(() => {
            const FIcon = fallbackIcons[channel.type] ?? MessageSquare;
            return <FIcon className="w-3.5 h-3.5 text-muted-foreground/60 flex-shrink-0" />;
          })()}
          <span className="text-sm text-foreground/70 shrink-0">
            {channel.credential_id
              ? credentials.find((c) => c.id === channel.credential_id)?.name ?? channel.type
              : channel.type === ('in-app' as string)
                ? 'In-app Messaging'
                : channel.type}
          </span>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => onToggle(channel)}
            className="p-1 text-muted-foreground/40 hover:text-red-400 transition-colors"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      ))}

      {channelOptions.length <= 1 && (
        <p className="text-sm text-muted-foreground/60 italic">
          Save communication credentials (Slack, Email, etc.) in the Vault to see them here.
        </p>
      )}
    </div>
  );
}
