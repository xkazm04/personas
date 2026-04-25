import type { CSSProperties } from 'react';
import type { PluginTab } from '@/lib/types/types';

interface PluginAccent {
  /** Solid color stop for the top-border gradient (left edge). */
  gradientFrom: string;
  /** Faded color stop for the top-border gradient (right edge). */
  gradientTo: string;
  /** RGB triplet (space-separated) used inside `rgb(var(--plugin-glow) / X)`. */
  glow: string;
}

const PLUGIN_ACCENTS: Record<Exclude<PluginTab, 'browse'>, PluginAccent> = {
  artist: {
    gradientFrom: 'rgb(244 63 94)',
    gradientTo: 'rgb(244 63 94 / 0.2)',
    glow: '244 63 94',
  },
  'dev-tools': {
    gradientFrom: 'rgb(245 158 11)',
    gradientTo: 'rgb(245 158 11 / 0.2)',
    glow: '245 158 11',
  },
  'obsidian-brain': {
    gradientFrom: 'rgb(139 92 246)',
    gradientTo: 'rgb(139 92 246 / 0.2)',
    glow: '139 92 246',
  },
  'research-lab': {
    gradientFrom: 'rgb(16 185 129)',
    gradientTo: 'rgb(16 185 129 / 0.2)',
    glow: '16 185 129',
  },
  drive: {
    gradientFrom: 'rgb(14 165 233)',
    gradientTo: 'rgb(14 165 233 / 0.2)',
    glow: '14 165 233',
  },
  twin: {
    gradientFrom: 'rgb(168 85 247)',
    gradientTo: 'rgb(168 85 247 / 0.2)',
    glow: '168 85 247',
  },
};

export function getPluginTheme(id: PluginTab): CSSProperties {
  if (id === 'browse') return {};
  const accent = PLUGIN_ACCENTS[id];
  return {
    '--plugin-gradient-from': accent.gradientFrom,
    '--plugin-gradient-to': accent.gradientTo,
    '--plugin-glow': accent.glow,
  } as CSSProperties;
}
