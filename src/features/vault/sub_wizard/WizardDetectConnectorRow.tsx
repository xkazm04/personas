import { motion } from 'framer-motion';
import { CheckCircle2, Monitor } from 'lucide-react';
import { ThemedConnectorIcon } from '@/features/shared/components/display/ConnectorMeta';
import type { AuthDetection } from '@/api/auth/authDetect';
import type { ConnectorDefinition } from '@/lib/types/types';
import { staggerItem } from '@/features/templates/animationPresets';
import { isDesktopBridge } from '@/lib/utils/platform/connectors';

interface WizardDetectConnectorRowProps {
  connector: ConnectorDefinition;
  isAdded: boolean;
  isSelected: boolean;
  detection: AuthDetection | undefined;
  onToggle: (name: string) => void;
}

export function WizardDetectConnectorRow({
  connector,
  isAdded,
  isSelected,
  detection,
  onToggle,
}: WizardDetectConnectorRowProps) {
  return (
    <motion.button
      key={connector.id}
      variants={staggerItem}
      onClick={() => {
        if (isAdded) return;
        onToggle(connector.name);
      }}
      disabled={isAdded}
      className={`group flex items-center gap-3 px-3.5 py-3 rounded-xl border transition-all text-left ${
        isAdded
          ? 'border-primary/5 bg-secondary/10 opacity-40 cursor-not-allowed'
          : isSelected
            ? 'border-violet-500/30 bg-violet-500/10'
            : 'border-primary/10 bg-secondary/20 hover:bg-secondary/40 hover:border-primary/20'
      }`}
    >
      {/* Checkbox */}
      {!isAdded && (
        <div
          className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
            isSelected
              ? 'bg-violet-500 border-violet-500'
              : 'border-primary/20'
          }`}
        >
          {isSelected && (
            <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          )}
        </div>
      )}

      {/* Icon */}
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-sm font-bold"
        style={{
          backgroundColor: `${connector.color}15`,
          color: connector.color,
          border: `1px solid ${connector.color}30`,
        }}
      >
        {connector.icon_url ? (
          <ThemedConnectorIcon url={connector.icon_url} label={connector.label} color={connector.color} size="w-4 h-4" />
        ) : (
          connector.label.charAt(0).toUpperCase()
        )}
      </div>

      {/* Label + detection badge */}
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium text-foreground/90 block truncate">
          {connector.label}
        </span>
        <span className="text-sm text-muted-foreground/60 block truncate">
          {isAdded
            ? 'Already added'
            : detection
              ? detection.identity ?? `Detected via ${detection.method}`
              : `${connector.fields.length} field${connector.fields.length !== 1 ? 's' : ''}`}
        </span>
      </div>

      {/* Desktop bridge badge */}
      {isDesktopBridge(connector) && !isAdded && (
        <span className="flex items-center gap-1 text-sm px-1.5 py-0.5 rounded-full shrink-0 bg-orange-500/10 text-orange-400 border border-orange-500/20">
          <Monitor className="w-2.5 h-2.5" />
          Local
        </span>
      )}

      {/* Detection badge */}
      {detection && !isAdded && (
        <span className={`text-sm px-1.5 py-0.5 rounded-full shrink-0 ${
          detection.confidence === 'high'
            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
            : 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20'
        }`}>
          {detection.method === 'cli' ? 'CLI auth' : 'Session'}
        </span>
      )}

      {isAdded && (
        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400/40 shrink-0" />
      )}
    </motion.button>
  );
}
