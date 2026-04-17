import { useState, useEffect, useRef } from 'react';
import { useTranslation } from '@/i18n/useTranslation';

interface InlineConfirmProps {
  message: string;
  onConfirm: () => void;
  children: (props: { requestConfirm: () => void }) => React.ReactNode;
}

export function InlineConfirm({ message, onConfirm, children }: InlineConfirmProps) {
  const [open, setOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const { t } = useTranslation();
  const st = t.sharing;

  useEffect(() => {
    if (!open) return;

    // Auto-dismiss after 3 seconds
    timerRef.current = setTimeout(() => setOpen(false), 3000);

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);

    return () => {
      clearTimeout(timerRef.current);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      {children({ requestConfirm: () => setOpen(true) })}
      {open && (
        <div className="absolute right-0 bottom-full mb-1 z-50 rounded-card border border-border bg-background shadow-elevation-3 p-2.5 min-w-[180px]">
          <p className="typo-caption text-foreground mb-2">{message}</p>
          <div className="flex gap-1.5 justify-end">
            <button
              onClick={() => setOpen(false)}
              className="px-2 py-1 text-[11px] rounded-input border border-border hover:bg-secondary/50 text-foreground"
            >
              {st.cancel}
            </button>
            <button
              onClick={() => {
                setOpen(false);
                onConfirm();
              }}
              className="px-2 py-1 text-[11px] rounded-input bg-red-500/90 text-white hover:bg-red-500"
            >
              {st.confirm}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
