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
      className="fixed inset-0 z-[9998] flex items-center justify-center bg-background/60 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-[360px] rounded-xl border border-primary/20 bg-background/95 shadow-xl p-4">
        <div className="typo-heading-sm text-foreground mb-3">{title}</div>
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder={placeholder}
          className="w-full px-3 py-2 rounded-md bg-secondary/40 border border-primary/15 typo-body text-foreground placeholder:text-foreground/40 focus:outline-none focus:ring-1 focus:ring-sky-500/50"
        />
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 rounded-md typo-caption font-medium text-foreground/70 hover:bg-secondary/50 transition-colors"
          >
            {t.plugins.drive.cancel}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!value.trim()}
            className="px-3 py-1.5 rounded-md bg-sky-500/20 text-sky-300 border border-sky-500/30 typo-caption font-medium hover:bg-sky-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
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
      className="fixed inset-0 z-[9998] flex items-center justify-center bg-background/60 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-[400px] rounded-xl border border-primary/20 bg-background/95 shadow-xl p-4">
        <div className="typo-heading-sm text-foreground mb-2">{title}</div>
        {body && (
          <div className="typo-caption text-foreground/60 mb-4">{body}</div>
        )}
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 rounded-md typo-caption font-medium text-foreground/70 hover:bg-secondary/50 transition-colors"
          >
            {t.plugins.drive.cancel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`px-3 py-1.5 rounded-md typo-caption font-medium border transition-colors ${
              danger
                ? "bg-rose-500/20 text-rose-300 border-rose-500/30 hover:bg-rose-500/30"
                : "bg-sky-500/20 text-sky-300 border-sky-500/30 hover:bg-sky-500/30"
            }`}
          >
            {t.plugins.drive.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}
