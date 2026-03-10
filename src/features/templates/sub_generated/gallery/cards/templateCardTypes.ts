import {
  Clock,
  Webhook,
  MousePointerClick,
  Radio,
} from 'lucide-react';

export const TRIGGER_ICONS: Record<string, typeof Clock> = {
  schedule: Clock,
  webhook: Webhook,
  manual: MousePointerClick,
  polling: Radio,
};

export const PREVIEW_DELAY_MS = 300;

export interface TemplateCardProps {
  review: import('@/lib/bindings/PersonaDesignReview').PersonaDesignReview;
  onAdopt: () => void;
  onViewDetails: () => void;
  onDelete: () => void;
  onViewFlows: () => void;
  onTryIt: () => void;
  installedConnectorNames: Set<string>;
  credentialServiceTypes: Set<string>;
}
