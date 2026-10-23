import { useEffect, useRef, useState } from 'react';
import { Send } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Button } from '@/features/shared/components/buttons';
import { Keycap } from '@/features/decision-center/deck/parts';
import '@/features/decision-center/deck/aurora.css';
import { usePipelineStore } from '@/stores/pipelineStore';
import { toastCatch } from '@/lib/silentCatch';
import type { Persona } from '@/lib/bindings/Persona';

/**
 * A persona conversation's composer: plain send only (no Route, no @-mention:
 * there is one interlocutor), in the deck's well like the team composer, the
 * send key printed once. Never disabled: consecutive sends queue as echoes.
 */
export function PersonaComposer({ persona }: { persona: Persona }) {
  const { t, tx } = useTranslation();
  const send = usePipelineStore((s) => s.sendPersonaChannelMessage);
  const [draft, setDraft] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  // rAF-batched autosize, the same rationale as the team composer.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
    });
    return () => cancelAnimationFrame(id);
  }, [draft]);

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    // Fire-and-forget: the echo renders at once; a failed post marks it in place and toasts.
    void send(persona.id, text).catch(toastCatch('personaChannel:send'));
  };
  const placeholder = tx(t.monitor.conv_persona_composer_placeholder, { name: persona.name.replace(/^T:\s*/, '') });

  return (
    <div className="au-scope flex-shrink-0 border-t border-border px-3 py-2">
      <div className="au-well flex items-end gap-2 rounded-input px-3 py-1">
        <textarea
          ref={ref}
          rows={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={placeholder}
          aria-label={placeholder}
          className="min-w-0 flex-1 resize-none bg-transparent py-1.5 typo-body text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
        <Button
          variant="ghost"
          size="sm"
          onClick={submit}
          disabled={!draft.trim()}
          icon={<Send className="h-4 w-4" aria-hidden />}
          className="au-lift mb-0.5 flex-shrink-0 text-status-success [&>span:last-child]:inline-flex [&>span:last-child]:items-center [&>span:last-child]:gap-1.5"
        >
          {t.monitor.conv_composer_send} <Keycap>↵</Keycap>
        </Button>
      </div>
    </div>
  );
}
