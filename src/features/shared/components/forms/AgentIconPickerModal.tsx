import { useCallback } from 'react';
import { X } from 'lucide-react';
import { BaseModal } from '@/lib/ui/BaseModal';
import {
  AGENT_ICONS,
  toAgentIconValue,
  resolveAgentIconSprite,
  resolveAgentIconSrc,
  isAgentIcon,
} from '@/lib/icons/agentIconCatalog';
import { useIsDarkTheme } from '@/stores/themeStore';
import { useTranslation } from '@/i18n/useTranslation';

interface AgentIconPickerModalProps {
  isOpen: boolean;
  value: string;
  onChange: (icon: string) => void;
  onClose: () => void;
}

/**
 * Modal-based agent icon picker — agent icons only, no emojis or connector
 * brand icons. Replaces the small in-flow PopupIconSelector when the surface
 * has room for a full-screen selection experience. Tiles are ~3× the size of
 * the popup variant (120px vs 40px) so the themed art is actually legible.
 */
export function AgentIconPickerModal({ isOpen, value, onChange, onClose }: AgentIconPickerModalProps) {
  const { t } = useTranslation();
  const isDark = useIsDarkTheme();

  const handlePick = useCallback((iconValue: string) => {
    onChange(iconValue);
    onClose();
  }, [onChange, onClose]);

  const handleClear = useCallback(() => {
    onChange('');
    onClose();
  }, [onChange, onClose]);

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      titleId="agent-icon-picker-title"
      size="xl"
      portal
    >
      <div className="flex flex-col max-h-[85vh]">
        <header className="flex items-start justify-between px-6 py-4 border-b border-primary/10 flex-shrink-0">
          <div>
            <h2
              id="agent-icon-picker-title"
              className="typo-heading font-semibold text-foreground/90"
            >
              {t.shared.forms_extra.select_agent_icon}
            </h2>
            <p className="text-[12px] text-foreground mt-0.5">
              {t.shared.forms_extra.select_agent_icon_desc}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-card hover:bg-secondary/50 transition-colors text-foreground hover:text-foreground/95 cursor-pointer"
            aria-label={t.common.close}
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-6">
          <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-4">
            {AGENT_ICONS.map((entry) => {
              const iconValue = toAgentIconValue(entry.id);
              const isSelected = value === iconValue;
              const sprite = resolveAgentIconSprite(iconValue, isDark);
              return (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => handlePick(iconValue)}
                  title={entry.label}
                  className={`group relative aspect-square w-full rounded-modal border flex flex-col items-center justify-center gap-2 p-3 transition-all cursor-pointer ${
                    isSelected
                      ? 'border-primary ring-2 ring-primary/30 bg-primary/10 scale-[1.03]'
                      : 'border-primary/15 bg-background/40 hover:bg-secondary/50 hover:border-primary/30 hover:scale-[1.02]'
                  }`}
                  style={isSelected ? { backgroundColor: `${entry.suggestedColor}1f` } : undefined}
                >
                  {sprite ? (
                    <div
                      aria-hidden="true"
                      className="agent-icon-sprite w-[72%] h-[72%]"
                      style={{
                        backgroundImage: `url(${sprite.src})`,
                        backgroundSize: `${sprite.columns * 100}% 100%`,
                        backgroundPosition: `${sprite.columns <= 1 ? 0 : (sprite.index / (sprite.columns - 1)) * 100}% 0%`,
                      }}
                    />
                  ) : (
                    <img
                      src={resolveAgentIconSrc(iconValue, isDark)}
                      alt={entry.label}
                      className="w-[72%] h-[72%] object-contain"
                      loading="lazy"
                    />
                  )}
                  <span className="typo-caption text-foreground truncate w-full text-center">
                    {entry.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {isAgentIcon(value) && (
          <footer className="flex items-center justify-end gap-2 px-6 py-3 border-t border-primary/10 flex-shrink-0">
            <button
              type="button"
              onClick={handleClear}
              className="px-3 py-1.5 typo-body rounded-card text-foreground hover:text-foreground hover:bg-secondary/40 transition-colors cursor-pointer"
            >
              {t.shared.forms_extra.clear_icon}
            </button>
          </footer>
        )}
      </div>
    </BaseModal>
  );
}
