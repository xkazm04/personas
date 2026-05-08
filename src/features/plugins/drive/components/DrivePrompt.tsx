import { useEffect, useRef, useState } from "react";
import { useTranslation } from "@/i18n/useTranslation";

interface TextPromptProps {
  title: string;
  placeholder?: string;
  initialValue?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

export function DriveTextPrompt({
  title,
  placeholder,
  initialValue = "",
  onConfirm,
  onCancel,
}: TextPromptProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 10);
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onCancel]);

  const submit = () => {
    const trimmed = value.trim();
    if (trimmed) onConfirm(trimmed);
  };

  return (
    <div
      className="fixed inset-0 z-[9998] flex items-center justify-center bg-background/60 surface-blur-modal"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-[360px] rounded-modal border border-primary/25 bg-background/95 shadow-elevation-3 p-4">
        <div className="typo-section-title mb-3">{title}</div>
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder={placeholder}
          className="w-full px-3 py-2 rounded-input bg-secondary/40 border border-primary/20 typo-body text-foreground placeholder:text-foreground focus:outline-none focus:border-sky-500/50 focus:ring-2 focus:ring-sky-500/20"
        />
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 rounded-input typo-body font-medium text-foreground hover:bg-secondary/60 transition-colors"
          >
            {t.plugins.drive.cancel}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!value.trim()}
            className="px-3 py-1.5 rounded-input bg-sky-500/25 text-sky-100 border border-sky-500/40 typo-body font-semibold hover:bg-sky-500/35 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {t.plugins.drive.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}

interface ConfirmPromptProps {
  title: string;
  body?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DriveConfirm({
  title,
  body,
  danger,
  onConfirm,
  onCancel,
}: ConfirmPromptProps) {
  const { t } = useTranslation();

  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-[9998] flex items-center justify-center bg-background/60 surface-blur-modal"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-[400px] rounded-modal border border-primary/25 bg-background/95 shadow-elevation-3 p-4">
        <div className="typo-section-title mb-2">{title}</div>
        {body && (
          <div className="typo-body text-foreground mb-4 leading-relaxed">{body}</div>
        )}
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 rounded-input typo-body font-medium text-foreground hover:bg-secondary/60 transition-colors"
          >
            {t.plugins.drive.cancel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`px-3 py-1.5 rounded-input typo-body font-semibold border transition-colors ${
              danger
                ? "bg-rose-500/25 text-rose-100 border-rose-500/45 hover:bg-rose-500/35"
                : "bg-sky-500/25 text-sky-100 border-sky-500/40 hover:bg-sky-500/35"
            }`}
          >
            {t.plugins.drive.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}
