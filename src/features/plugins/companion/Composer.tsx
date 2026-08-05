/**
 * Composer — the textarea + dictation + send buttons at the bottom of
 * the companion panel. Owns its own draft state; emits the send
 * callback to the panel orchestrator.
 *
 * (The old wrench-send / self-improve button was retired when dev mode
 * landed — improvement requests now flow through normal conversation
 * and Athena proposes `dev_improve` dispatches herself; see
 * docs/tests/athena/dev-mode-direction.md.)
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
import { Mic, MicOff, Send } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';

import { useCompanionStore } from './companionStore';
import { useDictation } from './useDictation';
import { createSendNonce } from './sendNonceLedger';
import {
  SlashPalette,
  filterSlashPresets,
  type SlashPreset,
} from './SlashPalette';

export function Composer({
  disabled,
  onSend,
  onDailyBrief,
  onAnalyzeFleet,
  compact = false,
}: {
  disabled: boolean;
  /**
   * `nonce` is a fresh, client-generated idempotency key minted right here
   * at send time — one per user send intent, never reused across retries.
   * It rides all the way to the dispatch call so a replay carrying the same
   * nonce (e.g. after a restart mid-turn) is dropped there instead of firing
   * a duplicate turn. See sendNonceLedger.ts.
   */
  onSend: (text: string, nonce: string) => void;
  onDailyBrief: () => void;
  onAnalyzeFleet: () => void;
  /** Slim/mobile-like layout for the panel's minimized width — tighter padding + gaps. */
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const conversationId = useCompanionStore((s) => s.activeConversationId);
  const setPersistedDraft = useCompanionStore((s) => s.setDraft);
  // Seeded once from the store on mount, then owned locally so every
  // keystroke doesn't force a re-render off the store's `draftsByConversation`
  // map — `setDraft` below writes back through so it stays durable.
  const [draft, setDraftState] = useState(
    () => useCompanionStore.getState().draftsByConversation[conversationId] ?? '',
  );
  const [slashIndex, setSlashIndex] = useState(0);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const dictation = useDictation();

  // Rehydrate the draft when the focused conversation changes (the panel
  // stays mounted across thread switches, so this can't rely on a fresh
  // `useState` initializer).
  const prevConversationIdRef = useRef(conversationId);
  useEffect(() => {
    if (prevConversationIdRef.current === conversationId) return;
    prevConversationIdRef.current = conversationId;
    setDraftState(useCompanionStore.getState().draftsByConversation[conversationId] ?? '');
  }, [conversationId]);

  const setDraft = useCallback(
    (value: string | ((prev: string) => string)) => {
      setDraftState((prev) => {
        const next = typeof value === 'function' ? value(prev) : value;
        setPersistedDraft(conversationId, next);
        return next;
      });
    },
    [conversationId, setPersistedDraft],
  );

  const slashPresets: SlashPreset[] = useMemo(
    () => [
      {
        key: 'intake',
        label: t.plugins.companion.slash_label_intake,
        message: t.plugins.companion.slash_message_intake,
      },
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
      {
        key: 'daily_brief',
        label: t.plugins.companion.daily_brief,
        action: onDailyBrief,
      },
      {
        key: 'analyze_fleet',
        label: t.plugins.companion.analyze_fleet,
        action: onAnalyzeFleet,
      },
    ].sort((a, b) => a.label.localeCompare(b.label)),
    [t.plugins.companion, onDailyBrief, onAnalyzeFleet],
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
    // Claim atomically: consumePendingPrompt reads-and-clears in the store, so
    // React StrictMode's dev double-invoke of this effect (which reuses the
    // same `pendingPrompt` closure) can't fire onSend twice — the second
    // invoke gets null here and bails. (Clearing the store but sending from the
    // closure value previously double-sent under StrictMode.)
    const claimed = useCompanionStore.getState().consumePendingPrompt();
    if (!claimed) return;
    const forceDraft = (globalThis as { __TEST_FORCE_DRAFT__?: boolean })
      .__TEST_FORCE_DRAFT__;
    if (claimed.autoSend && !disabled && !forceDraft) {
      onSend(claimed.text, createSendNonce());
    } else {
      setDraft(claimed.text);
    }
  }, [pendingPrompt, disabled, onSend, setDraft]);

  useEffect(() => {
    if (!dictation.finalText) return;
    setDraft((prev) =>
      prev ? `${prev.replace(/\s+$/, '')} ${dictation.finalText}` : dictation.finalText,
    );
    dictation.reset();
  }, [dictation.finalText, dictation, setDraft]);

  const submit = useCallback(() => {
    if (disabled || !draft.trim()) return;
    // Minted fresh on every submit — retyping and resending the same text
    // intentionally gets a new nonce and always goes through; dedup is on
    // the nonce, never on the text.
    onSend(draft, createSendNonce());
    setDraft('');
  }, [disabled, draft, onSend, setDraft]);

  const pickSlashPreset = useCallback((preset: SlashPreset) => {
    // Deterministic command entries (Daily Brief / Analyze Fleet) run their
    // action on pick instead of seeding the textarea — routing them through a
    // chat message would change their behavior.
    if (preset.action) {
      preset.action();
      setDraft('');
      setSlashIndex(0);
      return;
    }
    const message = preset.message ?? '';
    setDraft(message);
    setSlashIndex(0);
    // Defer focus so the textarea cursor lands at the end of the inserted text.
    requestAnimationFrame(() => {
      const el = taRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(message.length, message.length);
      }
    });
  }, [setDraft]);

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
    [paletteOpen, filteredPresets, slashIndex, pickSlashPreset, submit, setDraft],
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
    <div
      className={`border-t border-foreground/10 shrink-0 relative ${
        compact ? 'px-2 py-2' : 'px-3 py-3'
      }`}
    >
      {paletteOpen && (
        <div
          className={`absolute bottom-full z-10 ${compact ? 'left-2 right-2 mb-1' : 'left-3 right-3 mb-1.5'}`}
        >
          <SlashPalette
            query={slashQuery}
            selectedIndex={slashIndex}
            presets={filteredPresets}
            onSelect={pickSlashPreset}
            onHoverIndex={setSlashIndex}
          />
        </div>
      )}
      <div
        className={`flex items-end rounded-card bg-foreground/5 border border-foreground/10 transition-colors focus-within:border-primary/40 focus-within:bg-foreground/[0.07] ${
          compact ? 'gap-1 px-2 py-1.5' : 'gap-2 px-3 py-2'
        }`}
      >
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
            className={`rounded-interactive transition-colors focus-ring disabled:opacity-40 disabled:cursor-not-allowed ${
              compact ? 'p-1.5' : 'p-2'
            } ${
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
        {/* a11y — announce when the mic goes hot; the visual cue is color-only. */}
        {dictation.supported && (
          <span className="sr-only" aria-live="assertive">
            {dictation.listening ? t.plugins.companion.dictate_listening_hint : ''}
          </span>
        )}
        <button
          type="button"
          onClick={submit}
          disabled={disabled || !draft.trim() || paletteOpen}
          data-testid="companion-send"
          className={`rounded-interactive bg-primary text-primary-foreground disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity focus-ring ${
            compact ? 'p-1.5' : 'p-2'
          }`}
          aria-label={t.plugins.companion.send}
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
