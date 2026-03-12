import React from 'react';
import { ConnectorIcon } from '@/features/shared/components/display/ConnectorMeta';
import type { ConnectorMeta } from '@/features/shared/components/display/ConnectorMeta';

interface ConnectorIconButtonProps {
  connectorName: string;
  meta: ConnectorMeta;
  isReady: boolean;
  onAddCredential: (connectorName: string) => void;
}

export function ConnectorIconButton({
  connectorName,
  meta,
  isReady,
  onAddCredential,
}: ConnectorIconButtonProps) {
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isReady) return;
    onAddCredential(connectorName);
  };

  return (
    <div
      className="relative flex-shrink-0"
      title={`${meta.label}${isReady ? '' : ' -- click to add credential'}`}
      data-testid={`connector-readiness-dot-${connectorName}`}
    >
      <div
        onClick={handleClick}
        className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all ${
          isReady
            ? ''
            : 'grayscale hover:grayscale-0 cursor-pointer hover:ring-2 hover:ring-amber-500/30'
        }`}
        style={{ backgroundColor: `${meta.color}18` }}
      >
        <ConnectorIcon meta={meta} size="w-4 h-4" />
      </div>
      <span
        className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full ${
          isReady
            ? 'bg-emerald-500'
            : 'bg-amber-500/60 border border-dashed border-amber-500/30'
        }`}
      />
    </div>
  );
}
