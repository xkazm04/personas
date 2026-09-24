/**
 * The ten curated starting voices, ONE LAYER DOWN.
 *
 * They used to sit in the forge column inside their own `max-h-72
 * overflow-y-auto`, nested in the column's scroller — two scrollbars on a
 * create screen, and the heaviest choice of the phase competing with the name
 * field for the same sight. Here the main sight keeps three tiles and this
 * dialog holds the long list; picking one closes it immediately, so the forge
 * never grows a second scroller.
 */

import { Palette, X } from 'lucide-react';
import { BaseModal } from '@/lib/ui/BaseModal';
import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import { STYLE_PRESETS } from '../../../setup/style/stylePresets';
import type { StylePresetId } from '../../../setup/style/styleContract';
import { StyleTile } from './StyleTile';

interface StylePresetDialogProps {
  selected: StylePresetId | null;
  onPick: (id: StylePresetId) => void;
  onClose: () => void;
}

export function StylePresetDialog({ selected, onPick, onClose }: StylePresetDialogProps) {
  const { t } = useTranslation();
  const xg = t.twin.experience_grok;
  const ts = t.twin.style;

  return (
    <BaseModal
      isOpen
      onClose={onClose}
      titleId="twin-forge-style-picker-title"
      portal
      size="lg"
      staggerChildren={false}
      panelClassName="w-full max-h-[80vh] flex flex-col overflow-hidden rounded-modal glass-md shadow-elevation-3 border border-primary/20 bg-background"
    >
      <div className="flex-shrink-0 flex items-start gap-3 px-6 py-4 border-b border-primary/15">
        <div className="flex-1 min-w-0">
          <h2 id="twin-forge-style-picker-title" className="typo-section-title text-foreground">
            {xg.forge.style}
          </h2>
          <p className="typo-caption">{xg.forge.styleHint}</p>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          aria-label={xg.close}
          data-testid="create-twin-style-close"
          icon={<X className="w-4 h-4" />}
        />
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
        <div className="grid gap-2 sm:grid-cols-2">
          {STYLE_PRESETS.map((preset) => (
            <StyleTile
              key={preset.id}
              selected={selected === preset.id}
              onSelect={() => onPick(preset.id)}
              title={ts.presets[preset.id].name}
              body={ts.presets[preset.id].summary}
              icon={<Palette className="w-3.5 h-3.5" />}
              testId={`create-twin-style-${preset.id}`}
            />
          ))}
        </div>
      </div>
    </BaseModal>
  );
}

export default StylePresetDialog;
