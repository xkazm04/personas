import { useCallback, useEffect, useState } from 'react';
import { X, Upload, Trash2, Loader2, Sparkles } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { BaseModal } from '@/lib/ui/BaseModal';
import { AGENT_ICONS, toAgentIconValue } from '@/lib/icons/agentIconCatalog';
import {
  toCustomIconValue,
  isCustomIcon,
  parseCustomIconId,
} from '@/lib/icons/customIconStore';
import { resolvePersonaIcon } from '@/lib/icons/resolvePersonaIcon';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import {
  importPersonaIcon,
  listPersonaIcons,
  deletePersonaIcon,
  listImageGenCredentials,
  generatePersonaIcon,
} from '@/api/agents/personaIcons';
import type { ImageGenCredential } from '@/lib/bindings/ImageGenCredential';
import { toastCatch } from '@/lib/silentCatch';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import { useTranslation } from '@/i18n/useTranslation';

interface PersonaIconPickerModalProps {
  isOpen: boolean;
  value: string;
  onChange: (icon: string) => void;
  onClose: () => void;
  /** Persona name — seeds the AI-generation prompt. */
  personaName?: string;
  /** Persona description — seeds the AI-generation prompt. */
  personaDescription?: string | null;
}

/** Native dialog extension filter for uploadable persona icons. */
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif'];

/** Compose a default icon-generation prompt from the persona's identity. */
function buildIconPrompt(name?: string, description?: string | null): string {
  const subject = name?.trim() || 'an AI agent';
  const purpose = description?.trim() ? ` Purpose: ${description.trim()}.` : '';
  return `A minimal, modern app icon for "${subject}".${purpose} Flat vector style, single centered subject, bold simple shapes, solid background, no text or letters.`;
}

/**
 * Persona icon picker — built-in catalog icons plus user uploads.
 *
 * Three surfaces:
 *   - **Built-in**: the curated `AGENT_ICONS` catalog (theme-aware art).
 *   - **Upload**: pick an image file → backend decodes/downscales/re-encodes
 *     it to a stored PNG (see `persona_icons.rs`); the new icon is selected.
 *   - **Your icons**: previously uploaded icons, reusable across the fleet —
 *     the answer to large persona counts outgrowing 20 built-in choices.
 */
export function PersonaIconPickerModal({
  isOpen,
  value,
  onChange,
  onClose,
  personaName,
  personaDescription,
}: PersonaIconPickerModalProps) {
  const { t } = useTranslation();
  const [customIcons, setCustomIcons] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [genCreds, setGenCreds] = useState<ImageGenCredential[]>([]);
  const [selectedCredId, setSelectedCredId] = useState('');
  const [prompt, setPrompt] = useState('');
  const [generating, setGenerating] = useState(false);

  const refreshCustomIcons = useCallback(() => {
    listPersonaIcons()
      .then(setCustomIcons)
      .catch(toastCatch('PersonaIconPickerModal:listPersonaIcons'));
  }, []);

  // Load the uploaded-icon library + available image-gen credentials, and
  // seed the generation prompt, each time the modal opens.
  useEffect(() => {
    if (!isOpen) return;
    refreshCustomIcons();
    setPrompt(buildIconPrompt(personaName, personaDescription));
    listImageGenCredentials()
      .then((creds) => {
        setGenCreds(creds);
        setSelectedCredId((prev) =>
          creds.some((c) => c.id === prev) ? prev : creds[0]?.id ?? '',
        );
      })
      .catch(toastCatch('PersonaIconPickerModal:listImageGenCredentials'));
  }, [isOpen, refreshCustomIcons, personaName, personaDescription]);

  const handlePick = useCallback((iconValue: string) => {
    onChange(iconValue);
    onClose();
  }, [onChange, onClose]);

  const handleClear = useCallback(() => {
    onChange('');
    onClose();
  }, [onChange, onClose]);

  const handleUpload = useCallback(async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: 'Images', extensions: IMAGE_EXTENSIONS }],
      });
      const path = typeof selected === 'string' ? selected : null;
      if (!path) return;
      setUploading(true);
      const assetId = await importPersonaIcon(path);
      handlePick(toCustomIconValue(assetId));
    } catch (e) {
      toastCatch('PersonaIconPickerModal:importPersonaIcon')(e);
    } finally {
      setUploading(false);
    }
  }, [handlePick]);

  const handleDeleteCustom = useCallback((assetId: string) => {
    deletePersonaIcon(assetId)
      .then(() => {
        setCustomIcons((prev) => prev.filter((id) => id !== assetId));
        // If the persona currently uses the deleted icon, drop the reference.
        if (isCustomIcon(value) && parseCustomIconId(value) === assetId) {
          onChange('');
        }
      })
      .catch(toastCatch('PersonaIconPickerModal:deletePersonaIcon'));
  }, [value, onChange]);

  const handleGenerate = useCallback(async () => {
    if (!selectedCredId || !prompt.trim()) return;
    try {
      setGenerating(true);
      const assetId = await generatePersonaIcon(selectedCredId, prompt.trim());
      handlePick(toCustomIconValue(assetId));
    } catch (e) {
      toastCatch('PersonaIconPickerModal:generatePersonaIcon')(e);
    } finally {
      setGenerating(false);
    }
  }, [selectedCredId, prompt, handlePick]);

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      titleId="persona-icon-picker-title"
      size="xl"
      portal
    >
      <div className="flex flex-col max-h-[85vh]">
        <header className="flex items-start justify-between px-6 py-4 border-b border-primary/10 flex-shrink-0">
          <div>
            <h2
              id="persona-icon-picker-title"
              className="typo-heading font-semibold text-foreground/90"
            >
              {t.shared.forms_extra.select_persona_icon}
            </h2>
            <p className="text-[12px] text-foreground mt-0.5">
              {t.shared.forms_extra.select_persona_icon_desc}
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

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Built-in catalog */}
          <section>
            <h3 className="typo-caption font-semibold uppercase tracking-wide text-foreground mb-3">
              {t.shared.forms_extra.builtin_icons}
            </h3>
            <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-4">
              {AGENT_ICONS.map((entry) => {
                const iconValue = toAgentIconValue(entry.id);
                const isSelected = value === iconValue;
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
                    <PersonaIcon icon={iconValue} color={null} size="w-[72%] h-[72%]" />
                    <span className="typo-caption text-foreground truncate w-full text-center">
                      {entry.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* User uploads */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h3 className="typo-caption font-semibold uppercase tracking-wide text-foreground">
                {t.shared.forms_extra.your_icons}
              </h3>
              <button
                type="button"
                onClick={handleUpload}
                disabled={uploading}
                className="flex items-center gap-1.5 px-3 py-1.5 typo-caption font-medium rounded-card border border-primary/20 bg-background/50 text-foreground hover:bg-secondary/50 hover:border-primary/40 transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-default"
              >
                {uploading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Upload className="w-3.5 h-3.5" />
                )}
                {uploading
                  ? t.shared.forms_extra.uploading_icon
                  : t.shared.forms_extra.upload_icon}
              </button>
            </div>

            {customIcons.length === 0 ? (
              <p className="typo-caption text-foreground py-4 text-center">
                {t.shared.forms_extra.no_custom_icons}
              </p>
            ) : (
              <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-4">
                {customIcons.map((assetId) => {
                  const iconValue = toCustomIconValue(assetId);
                  const isSelected =
                    isCustomIcon(value) && parseCustomIconId(value) === assetId;
                  return (
                    <div
                      key={assetId}
                      className={`group relative aspect-square w-full rounded-modal border transition-all ${
                        isSelected
                          ? 'border-primary ring-2 ring-primary/30 bg-primary/10'
                          : 'border-primary/15 bg-background/40 hover:bg-secondary/50 hover:border-primary/30'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => handlePick(iconValue)}
                        title={t.shared.forms_extra.your_icons}
                        className="absolute inset-0 flex items-center justify-center p-3 cursor-pointer"
                      >
                        <PersonaIcon icon={iconValue} color={null} size="w-[72%] h-[72%]" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteCustom(assetId)}
                        aria-label={t.shared.forms_extra.remove_custom_icon}
                        title={t.shared.forms_extra.remove_custom_icon}
                        className="absolute top-1 right-1 p-1 rounded-card bg-background/80 text-foreground opacity-0 group-hover:opacity-100 hover:text-status-error hover:bg-secondary transition-all cursor-pointer"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* AI generation — only when the vault has an image-gen credential */}
          {genCreds.length > 0 && (
            <section>
              <h3 className="typo-caption font-semibold uppercase tracking-wide text-foreground mb-3 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5" />
                {t.shared.forms_extra.generate_with_ai}
              </h3>
              <div className="space-y-3 rounded-modal border border-primary/15 bg-background/40 p-4">
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={3}
                  disabled={generating}
                  placeholder={t.shared.forms_extra.generate_icon_prompt_placeholder}
                  className={`${INPUT_FIELD} resize-none`}
                />
                <div className="flex items-center justify-between gap-3">
                  {genCreds.length > 1 ? (
                    <select
                      value={selectedCredId}
                      onChange={(e) => setSelectedCredId(e.target.value)}
                      disabled={generating}
                      className={`${INPUT_FIELD} flex-1 min-w-0`}
                    >
                      {genCreds.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  ) : (
                    <span className="typo-caption text-foreground truncate">
                      {genCreds[0]?.name}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={handleGenerate}
                    disabled={generating || !prompt.trim() || !selectedCredId}
                    className="flex items-center gap-1.5 px-3 py-1.5 typo-caption font-medium rounded-card border border-primary/30 bg-primary/10 text-foreground hover:bg-primary/20 transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-default flex-shrink-0"
                  >
                    {generating ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5" />
                    )}
                    {generating
                      ? t.shared.forms_extra.generating_icon
                      : t.shared.forms_extra.generate_icon}
                  </button>
                </div>
              </div>
            </section>
          )}
        </div>

        {resolvePersonaIcon(value).kind !== 'fallback' && (
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
