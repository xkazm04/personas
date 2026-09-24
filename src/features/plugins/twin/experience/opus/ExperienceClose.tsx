/** The one way out of the layer, top right, the same on both phases. */

import { X } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';

export function ExperienceClose({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={onClose}
      aria-label={t.common.close}
      data-testid="xo-close"
      icon={<X className="w-4 h-4" />}
    />
  );
}

export default ExperienceClose;
