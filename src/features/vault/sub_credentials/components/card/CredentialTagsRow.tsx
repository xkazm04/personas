import { Tag, X, Plus } from 'lucide-react';
import { CopyButton } from '@/features/shared/components/buttons';
import { getTagStyle } from '@/features/vault/shared/utils/credentialTags';
import { Button } from '@/features/shared/components/buttons';
import type { useCredentialTags } from '@/features/vault/shared/hooks/useCredentialTags';
import { useTranslation } from '@/i18n/useTranslation';

type TagsHook = ReturnType<typeof useCredentialTags>;

interface CredentialTagsRowProps {
  tags: TagsHook;
}

export function CredentialTagsRow({ tags }: CredentialTagsRowProps) {
  const { t } = useTranslation();
  const {
    currentTags,
    tagInput,
    showTagInput,
    showSuggestions,
    filteredSuggestions,
    tagInputRef,
    copiedCredentialId,
    addTag,
    removeTag,
    copyCredentialId,
    startTagInput,
    onTagInputChange,
    onTagInputKeyDown,
    onTagInputBlur,
  } = tags;

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <Tag className="w-3 h-3 text-foreground shrink-0" />
      {currentTags.map((tag) => {
        const style = getTagStyle(tag);
        return (
          <span
            key={tag}
            className={`inline-flex items-center gap-1 text-sm font-medium px-1.5 py-0.5 rounded border ${style.bg} ${style.text} ${style.border}`}
          >
            {tag}
            <Button
              variant="ghost"
              size="icon-sm"
              icon={<X className="w-2.5 h-2.5" />}
              onClick={() => removeTag(tag)}
              title={`Remove tag "${tag}"`}
              className="hover:opacity-70 p-0"
            />
          </span>
        );
      })}
      {showTagInput ? (
        <div className="relative">
          <input
            ref={tagInputRef}
            type="text"
            value={tagInput}
            onChange={(e) => onTagInputChange(e.target.value)}
            onKeyDown={(e) => onTagInputKeyDown(e.key)}
            onBlur={onTagInputBlur}
            autoFocus
            placeholder={t.vault.credential_card.add_tag_placeholder}
            className="w-20 text-sm px-1.5 py-0.5 rounded border border-primary/20 bg-background/50 text-foreground placeholder:text-foreground focus-visible:outline-none focus-visible:border-primary/30"
          />
          {showSuggestions && filteredSuggestions.length > 0 && (
            <div className="absolute top-full mt-1 left-0 z-20 bg-background border border-primary/15 rounded-card shadow-elevation-3 py-1 min-w-[100px]">
              {filteredSuggestions.map((s) => (
                <Button
                  key={s}
                  variant="ghost"
                  size="sm"
                  onMouseDown={(e) => { e.preventDefault(); addTag(s); }}
                  className="w-full justify-start text-left px-2.5 py-1 hover:bg-secondary/50 text-foreground"
                >
                  {s}
                </Button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <Button
          variant="ghost"
          size="icon-sm"
          icon={<Plus className="w-2.5 h-2.5" />}
          onClick={startTagInput}
          title={t.vault.credential_card.add_tag_button}
          className="text-foreground hover:text-muted-foreground/70 p-0"
        />
      )}
      <CopyButton
        copied={copiedCredentialId}
        onCopy={copyCredentialId}
        label="id"
        tooltip={t.vault.credential_card.copy_credential_id}
        className="border border-primary/10 bg-secondary/20 text-foreground hover:text-foreground/80 px-2 py-0.5 text-xs font-mono"
      />
    </div>
  );
}
