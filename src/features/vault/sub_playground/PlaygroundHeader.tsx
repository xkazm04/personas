import { useState, useRef, useCallback } from 'react';
import { X, Plug, Key, Plus } from 'lucide-react';
import { ThemedConnectorIcon } from '@/features/shared/components/display/ConnectorMeta';
import { getCredentialTags, getTagStyle, buildMetadataWithTags, SUGGESTED_TAGS } from '@/features/vault/utils/credentialTags';
import { toCredentialMetadata } from '@/lib/types/types';
import { usePersonaStore } from '@/stores/personaStore';
import * as credApi from '@/api/vault/credentials';
import type { CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';

interface PlaygroundHeaderProps {
  credential: CredentialMetadata;
  connector: ConnectorDefinition | undefined;
  onClose: () => void;
}

export function PlaygroundHeader({ credential, connector, onClose }: PlaygroundHeaderProps) {
  const [tagInput, setTagInput] = useState('');
  const [showTagInput, setShowTagInput] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const tagInputRef = useRef<HTMLInputElement>(null);

  const currentTags = getCredentialTags(credential);
  const iconUrl = connector?.icon_url;
  const color = connector?.color || '#6B7280';
  const fieldKeys = connector?.fields?.map((f) => f.key) ?? [];

  const persistTags = useCallback(async (nextTags: string[]) => {
    const metadata = buildMetadataWithTags(credential, nextTags);
    try {
      const updatedRaw = await credApi.updateCredential(credential.id, {
        name: null,
        service_type: null,
        encrypted_data: null,
        metadata,
      });
      const updated = toCredentialMetadata(updatedRaw);
      usePersonaStore.setState((s) => ({
        credentials: s.credentials.map((c) => (c.id === credential.id ? updated : c)),
      }));
    } catch { /* intentional: non-critical -- tag metadata update is best-effort */ }
  }, [credential]);

  const addTag = useCallback((tag: string) => {
    const trimmed = tag.trim().toLowerCase();
    if (!trimmed || currentTags.includes(trimmed)) return;
    persistTags([...currentTags, trimmed]);
    setTagInput('');
    setShowSuggestions(false);
  }, [currentTags, persistTags]);

  const removeTag = useCallback((tag: string) => {
    persistTags(currentTags.filter((t) => t !== tag));
  }, [currentTags, persistTags]);

  const filteredSuggestions = SUGGESTED_TAGS.filter(
    (s) => !currentTags.includes(s) && s.includes(tagInput.toLowerCase()),
  );

  return (
    <div className="flex items-center gap-3 px-6 py-3 border-b border-primary/10 bg-secondary/20 shrink-0">
      <div
        className="w-9 h-9 rounded-lg flex items-center justify-center border border-primary/15 shrink-0"
        style={{ backgroundColor: `${color}15` }}
      >
        {iconUrl ? (
          <ThemedConnectorIcon url={iconUrl} label={connector?.label || credential.name} color={color} size="w-5 h-5" />
        ) : connector ? (
          <Plug className="w-5 h-5" style={{ color }} />
        ) : (
          <Key className="w-5 h-5 text-emerald-400/80" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <h2 className="text-sm font-semibold text-foreground/90 truncate mb-1">
          {credential.name}
        </h2>
        <div className="flex items-center gap-1.5 flex-wrap">
          {fieldKeys.map((key) => (
            <span key={key} className="text-xs px-1.5 py-0.5 rounded bg-secondary/40 border border-primary/8 text-muted-foreground/60 font-mono">
              {key}
            </span>
          ))}
          {currentTags.map((tag) => {
            const style = getTagStyle(tag);
            return (
              <span
                key={tag}
                className={`inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded border ${style.bg} ${style.text} ${style.border}`}
              >
                {tag}
                <button
                  onClick={() => removeTag(tag)}
                  className="hover:opacity-70 transition-opacity"
                  title={`Remove tag "${tag}"`}
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </span>
            );
          })}
          {showTagInput ? (
            <div className="relative">
              <input
                ref={tagInputRef}
                type="text"
                value={tagInput}
                onChange={(e) => { setTagInput(e.target.value); setShowSuggestions(true); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && tagInput.trim()) addTag(tagInput);
                  if (e.key === 'Escape') { setShowTagInput(false); setTagInput(''); setShowSuggestions(false); }
                }}
                onBlur={() => { setTimeout(() => { setShowTagInput(false); setTagInput(''); setShowSuggestions(false); }, 150); }}
                autoFocus
                placeholder="Add tag..."
                className="w-24 text-xs px-1.5 py-0.5 rounded border border-primary/20 bg-background/50 text-foreground/80 placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/30"
              />
              {showSuggestions && filteredSuggestions.length > 0 && (
                <div className="absolute top-full mt-1 left-0 z-20 bg-background border border-primary/15 rounded-lg shadow-lg py-1 min-w-[100px]">
                  {filteredSuggestions.map((s) => (
                    <button
                      key={s}
                      onMouseDown={(e) => { e.preventDefault(); addTag(s); }}
                      className="w-full text-left px-2.5 py-1 text-xs hover:bg-secondary/50 transition-colors text-foreground/80"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <button
              onClick={() => { setShowTagInput(true); setTimeout(() => tagInputRef.current?.focus(), 0); }}
              className="inline-flex items-center gap-0.5 text-xs text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors"
              title="Add tag"
            >
              <Plus className="w-2.5 h-2.5" /> tag
            </button>
          )}
        </div>
      </div>
      <button
        onClick={onClose}
        className="p-2 rounded-lg hover:bg-secondary/50 transition-colors text-muted-foreground/60 hover:text-foreground/80 shrink-0"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
