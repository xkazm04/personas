/**
 * Composer — the textarea + dictation + send/improve buttons at the
 * bottom of the companion panel. Owns its own draft state; emits send
 * + improve callbacks to the panel orchestrator.
 *
 * Three input paths:
 *   - Direct typing into the textarea (auto-grows up to ~6 lines).
 *   - Dictation via the mic button (browser SpeechRecognition through
 *     `useDictation`). Interim text shown as a display tail; final
 *     chunks fold into the persistent draft.
 *   - External seeding via `useCompanionStore.pendingPrompt` (set by
 *     "Play in chat" affordances on Overview surfaces). `autoSend` skips
 *     the manual click and fires onSend immediately; `__TEST_FORCE_DRAFT__`
 *     is a test-only escape hatch that downgrades autoSend to draft-only
 *     so Playwright specs can verify the seed wiring without queuing a
 *     real LLM call.
 *
 * Slash palette: typing `/` as the first character of an empty draft
 * opens a popover above the composer with a small set of preset prompts
 * (show goals, recent decisions, live ops, …). Subsequent keystrokes
 * filter the list; Arrow ↑/↓ + Enter pick a preset; Esc closes the
 * palette and clears the draft.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Mic, MicOff, Send, Wrench } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';

import { useCompanionStore } from './companionStore';
import { useDictation } from './useDictation';
import {
  SlashPalette,
  filterSlashPresets,
  type SlashPreset,
} from './SlashPalette';

export function Composer({
  disabled,
  onSend,
  onImprove,
  improveEnabled,
  improving,
}: {
  disabled: boolean;
  onSend: (text: string) => void;
  onImprove: (text: string) => void;
  improveEnabled: boolean;
  improving: boolean;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');
  const [slashIndex, setSlashIndex] = useState(0);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const dictation = useDictation();

  const slashPresets: SlashPreset[] = useMemo(
    () => [
      {
        key: 'goals',
        label: t.plugins.companion.slash_label_goals,
        message: t.plugins.companion.slash_message_goals,
      },
      {
        key: 'queued',
        label: t.plugins.companion.slash_label_queued,
        message: t.plugins.companion.slash_message_queued,
      },
      {
        key: 'decisions',
        label: t.plugins.companion.slash_label_decisions,
        message: t.plugins.companion.slash_message_decisions,
      },
      {
        key: 'live_ops',
        label: t.plugins.companion.slash_label_live_ops,
        message: t.plugins.companion.slash_message_live_ops,
      },
      {
        key: 'memory_recap',
        label: t.plugins.companion.slash_label_memory_recap,
        message: t.plugins.companion.slash_message_memory_recap,
      },
      {
        key: 'capabilities',
        label: t.plugins.companion.slash_label_capabilities,
        message: t.plugins.companion.slash_message_capabilities,
      },
    ],
    [t.plugins.companion],
  );

  // Palette is open whenever the draft begins with `/`. Subsequent chars
  // become the filter query (substring of label or key).
  const paletteOpen = draft.startsWith('/');
  const slashQuery = paletteOpen ? draft.slice(1) : '';
  const filteredPresets = useMemo(
    () => (paletteOpen ? filterSlashPresets(slashPresets, slashQuery) : []),
    [paletteOpen, slashQuery, slashPresets],
  );

  // Clamp selection if filter shrinks the list under the current index.
  useEffect(() => {
    if (!paletteOpen) {
      setSlashIndex(0);
      return;
    }
    if (slashIndex >= filteredPresets.length && filteredPresets.length > 0) {
      setSlashIndex(0);
    }
  }, [paletteOpen, filteredPresets.length, slashIndex]);

  const pendingPrompt = useCompanionStore((s) => s.pendingPrompt);
  useEffect(() => {
    if (!pendingPrompt) return;
    useCompanionStore.getState().setPendingPrompt(null);
    const forceDraft = (globalThis as { __TEST_FORCE_DRAFT__?: boolean })
      .__TEST_FORCE_DRAFT__;
    if (pendingPrompt.autoSend && !disabled && !forceDraft) {
      onSend(pendingPrompt.text);
    } else {
      setDraft(pendingPrompt.text);
    }
  }, [pendingPrompt, disabled, onSend]);

  useEffect(() => {
    if (!dictation.finalText) return;
    setDraft((prev) =>
      prev ? `${prev.replace(/\s+$/, '')} ${dictation.finalText}` : dictation.finalText,
    );
    dictation.reset();
  }, [dictation.finalText, dictation]);

  const submit = useCallback(() => {
    if (disabled || !draft.trim()) return;
    onSend(draft);
    setDraft('');
  }, [disabled, draft, onSend]);

  const submitImprove = useCallback(() => {
    if (disabled || improving || !draft.trim()) return;
    onImprove(draft);
    setDraft('');
  }, [disabled, improving, draft, onImprove]);

  const pickSlashPreset = useCallback((preset: SlashPreset) => {
    setDraft(preset.message);
    setSlashIndex(0);
    // Defer focus so the textarea cursor lands at the end of the inserted text.
    requestAnimationFrame(() => {
      const el = taRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(preset.message.length, preset.message.length);
      }
    });
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Slash-palette navigation takes priority when the palette is open
      // AND there's at least one filtered preset visible.
      if (paletteOpen && filteredPresets.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSlashIndex((i) => (i + 1) % filteredPresets.length);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSlashIndex(
            (i) => (i - 1 + filteredPresets.length) % filteredPresets.length,
          );
          return;
        }
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          const pick = filteredPresets[Math.min(slashIndex, filteredPresets.length - 1)];
          if (pick) pickSlashPreset(pick);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          setDraft('');
          return;
        }
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submit();
      }
    },
    [paletteOpen, filteredPresets, slashIndex, pickSlashPreset, submit],
  );

  // Auto-grow up to ~6 lines.
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [draft]);

  const placeholder = useMemo(
    () => t.plugins.companion.composer_placeholder,
    [t.plugins.companion.composer_placeholder],
  );

  // Visual indicator for what's currently being recognized — appended to the
  // textarea's value while listening. Kept in a separate variable so we don't
  // overwrite the user's draft; it's purely a display tail.
  const displayValue =
    dictation.listening && dictation.interimText
      ? `${draft}${draft ? ' ' : ''}${dictation.interimText}`
      : draft;

  return (
    <div className="border-t border-foreground/10 px-3 py-3 shrink-0 relative">
      {paletteOpen && (
        <div className="absolute left-3 right-3 bottom-full mb-1.5 z-10">
          <SlashPalette
            query={slashQuery}
            selectedIndex={slashIndex}
            presets={filteredPresets}
            onSelect={pickSlashPreset}
            onHoverIndex={setSlashIndex}
          />
        </div>
      )}
      <div className="flex items-end gap-2 rounded-card bg-foreground/5 px-3 py-2">
        <textarea
          ref={taRef}
          value={displayValue}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          data-testid="companion-composer"
          className="flex-1 bg-transparent border-0 outline-none resize-none typo-body text-foreground placeholder:text-foreground/40 disabled:opacity-50"
          aria-label={placeholder}
        />
        {dictation.supported && (
          <button
            type="button"
            onClick={() => (dictation.listening ? dictation.stop() : dictation.start())}
            disabled={disabled}
            className={`p-2 rounded-interactive transition-colors focus-ring disabled:opacity-40 disabled:cursor-not-allowed ${
              dictation.listening
                ? 'bg-red-500/15 text-red-400 hover:bg-red-500/25'
                : dictation.error
                  ? 'bg-amber-500/10 text-amber-400 hover:bg-amber-500/20'
                  : 'bg-foreground/5 text-foreground hover:bg-foreground/10 hover:text-foreground'
            }`}
            aria-label={
              dictation.listening
                ? t.plugins.companion.dictate_stop
                : t.plugins.companion.dictate_start
            }
            title={
              dictation.error
                ? t.plugins.companion.dictate_error
                : dictation.listening
                  ? t.plugins.companion.dictate_listening_hint
                  : t.plugins.companion.dictate_start_hint
            }
            aria-pressed={dictation.listening}
          >
            {dictation.listening ? (
              <MicOff className="w-4 h-4" />
            ) : (
              <Mic className="w-4 h-4" />
            )}
          </button>
        )}
        {improveEnabled && (
          <button
            onClick={submitImprove}
            disabled={disabled || improving || !draft.trim()}
            className="p-2 rounded-interactive bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors focus-ring"
            aria-label={t.plugins.companion.improve_send}
            title={t.plugins.companion.improve_send_title}
          >
            {improving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Wrench className="w-4 h-4" />
            )}
          </button>
        )}
        <button
          onClick={submit}
          disabled={disabled || !draft.trim() || paletteOpen}
          data-testid="companion-send"
          className="p-2 rounded-interactive bg-primary text-primary-foreground disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity focus-ring"
          aria-label={t.plugins.companion.send}
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
