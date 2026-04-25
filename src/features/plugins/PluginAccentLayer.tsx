import type { ReactNode } from 'react';
import type { PluginTab } from '@/lib/types/types';
import { getPluginTheme } from './pluginTheme';

interface PluginAccentLayerProps {
  pluginId: PluginTab;
  children: ReactNode;
  className?: string;
}

export function PluginAccentLayer({ pluginId, children, className }: PluginAccentLayerProps) {
  return (
    <div
      data-plugin-accent={pluginId}
      style={getPluginTheme(pluginId)}
      className={`relative flex-1 min-h-0 w-full flex flex-col overflow-hidden ${className ?? ''}`}
    >
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-px pointer-events-none z-20"
        style={{
          background:
            'linear-gradient(90deg, var(--plugin-gradient-from), var(--plugin-gradient-to))',
        }}
      />
      <div
        aria-hidden
        className="absolute top-0 left-0 w-[40rem] h-[24rem] pointer-events-none z-0"
        style={{
          background:
            'radial-gradient(60% 60% at 0% 0%, rgb(var(--plugin-glow) / 0.04), transparent 70%)',
        }}
      />
      <div className="relative z-[1] flex-1 min-h-0 w-full flex flex-col">{children}</div>
    </div>
  );
}
