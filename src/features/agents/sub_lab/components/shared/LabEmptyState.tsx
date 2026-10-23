import type { LucideIcon } from 'lucide-react';
import ScenarioEmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import type { EmptyArtMotif } from '@/features/shared/components/display/emptyArt/EmptyArt';
import { motifForIcon } from '@/features/shared/components/display/emptyArt/iconMotif';

interface LabEmptyStateProps {
  /** Read as its EmptyArt motif when it has one. */
  icon?: LucideIcon;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  size?: 'compact' | 'standard' | 'full';
  /** Illustration; else the icon's motif; else `runs` (Lab surfaces are run histories). */
  art?: EmptyArtMotif;
}

/** Lab's empty state: a thin wrapper over the shared ScenarioEmptyState. */
export function LabEmptyState({ icon, title, subtitle, action, size = 'standard', art }: LabEmptyStateProps) {
  return (
    <ScenarioEmptyState
      art={art ?? motifForIcon(icon) ?? 'runs'}
      size={size === 'full' ? 'md' : 'sm'}
      title={title}
      subtitle={subtitle}
    >
      {action}
    </ScenarioEmptyState>
  );
}
