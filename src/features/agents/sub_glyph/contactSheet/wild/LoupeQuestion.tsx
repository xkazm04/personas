/** LoupeQuestion: a clarifying question, asked inside its frame.
 *
 *  Options are numbered and the number keys pick them; the free-text answer
 *  sends on Enter; a connector-category question renders the real vault
 *  picker. One answer per question: after sending, the controls lock until the
 *  engine hands over the next question, so a fast double press can never
 *  answer twice or run the counter past the total. */
import { useEffect, useState } from "react";
import { Send } from "lucide-react";
import { VaultConnectorPicker } from "@/features/vault/components/VaultConnectorPicker";
import type { BuildQuestion } from "@/lib/types/buildTypes";
import { COPY } from "./wildCopy";

interface LoupeQuestionProps {
  question: BuildQuestion;
  index: number;
  total: number;
  onSubmit: (answer: string) => boolean;
}

export function LoupeQuestion({ question, index, total, onSubmit }: LoupeQuestionProps) {
  const [text, setText] = useState("");
  const [sent, setSent] = useState(false);
  const options = (question.options ?? []).slice(0, 9);
  const category = question.connectorCategory ?? null;
  const safeTotal = Math.max(total, 1);
  const safeIndex = Math.min(Math.max(index, 1), safeTotal);

  const submit = (v: string) => {
    const a = v.trim();
    if (!a || sent) return;
    if (onSubmit(a)) setSent(true);
  };

  useEffect(() => {
    if (category || sent) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const n = parseInt(e.key, 10);
      if (Number.isNaN(n) || n < 1 || n > options.length) return;
      e.preventDefault();
      submit(options[n - 1]!);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="flex flex-col gap-4 max-w-[760px] mx-auto">
      <span className="csw-edge" style={{ color: "var(--cs-safe)" }}>{COPY.questions.of(safeIndex, safeTotal)}</span>
      <p className="m-0" style={{ fontSize: 22, lineHeight: 1.35, fontWeight: 600, color: "var(--cs-ink)" }}>{question.question}</p>

      {category ? (
        <VaultConnectorPicker category={category} value="" onChange={(s) => submit(s)} suggested={question.suggested} />
      ) : (
        <>
          {options.length > 0 && (
            <div className="flex flex-col gap-1.5" role="group" aria-label={question.question}>
              {options.map((opt, i) => (
                <button key={`${i}-${opt}`} type="button" className="csw-opt" onClick={() => submit(opt)} disabled={sent} autoFocus={i === 0}>
                  <span className="csw-kbd">{i + 1}</span>
                  <span className="flex-1">{opt}</span>
                </button>
              ))}
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            {options.length > 0 && <span className="csw-edge" style={{ color: "var(--cs-faint)", textTransform: "none", letterSpacing: ".04em" }}>{COPY.questions.free}</span>}
            <div className="flex gap-2">
              <input
                className="csw-input"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(text); } }}
                aria-label={COPY.questions.free}
                disabled={sent}
                autoFocus={options.length === 0}
              />
              <button type="button" className="csw-btn" onClick={() => submit(text)} disabled={sent || !text.trim()}>
                <Send className="w-4 h-4" />
                {COPY.questions.send}
              </button>
            </div>
          </div>
        </>
      )}
      <span className="csw-body" style={{ fontSize: 14, color: sent ? "var(--cs-ok)" : "var(--cs-faint)" }} aria-live="polite">
        {sent ? COPY.questions.sent : COPY.questions.keys}
      </span>
    </div>
  );
}
